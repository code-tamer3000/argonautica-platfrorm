"""Серверный транскод видео в стриминг-дружественный H.264 720p (docs/FILES.md).

Клиент льёт ОРИГИНАЛ видео как любой файл (никакого сжатия в браузере — оно било по
батарее/памяти и заставляло ждать ДО заливки). Дальше видео обрабатывается в фоне
воркером: качаем оригинал из MinIO → ffprobe → транскод в H.264 720p + `+faststart`
(moov в начало, воспроизведение стартует до полной докачки) ИЛИ fast-path, если
исходник уже совместим → заливаем вариант + постер обратно в MinIO. Метаданные
варианта долговечны (Postgres, media_assets.variant_*), очередь/попытки — эфемерны
(Redis, см. transcode_queue.py).

ВНИМАНИЕ (CLAUDE.md п.7): здесь байты видео проходят через бэкенд — это осознанное
исключение из «медиа мимо FastAPI», как и генерация превью картинок. Работа тяжёлая
(сеть + ffmpeg): гоняется ТОЛЬКО в воркере, никогда в request-пути. Все функции
синхронные (subprocess/boto3) — в воркере они и так в своём процессе/потоке.
"""
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass

from app.core.config import settings
from app.services.media import (
    _encode_webp_thumbnail,
    _server_client,
    build_thumb_key,
)

logger = logging.getLogger(__name__)

# Ключ варианта: параллельный префикс, оригинал НЕ трогаем (его ключ уже `YYYY/MM/..`).
VARIANT_PREFIX = "video/720/"
VARIANT_MIME = "video/mp4"
_TARGET_MAX_HEIGHT = 720


class TranscodeError(Exception):
    """Транскод не удался (ffmpeg/ffprobe упали, таймаут, гардрейл). Джоба ретраится."""


@dataclass
class ProbeResult:
    """Разбор исходника ffprobe'ом: что за кодеки/размер/длительность/faststart."""

    video_codec: str | None
    audio_codec: str | None
    height: int | None
    duration: int | None
    faststart: bool  # moov-атом перед mdat → прогрессивное воспроизведение


def build_variant_key(storage_key: str) -> str:
    """Ключ варианта в том же бакете: `video/720/<storage_key без каталогов>.mp4`.

    Плоско под VARIANT_PREFIX по uuid из имени объекта — не смешиваем с оригиналами
    и превью. Расширение оригинала (`.mov`/`.webm`) отбрасываем: вариант всегда mp4.
    """
    name = storage_key.rsplit("/", 1)[-1]
    stem = name.rsplit(".", 1)[0] if "." in name else name
    return f"{VARIANT_PREFIX}{stem}.mp4"


def _ffprobe(path: str) -> ProbeResult:
    """Разобрать локальный файл ffprobe'ом (JSON). Бросает TranscodeError при сбое."""
    import json

    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "stream=codec_type,codec_name,height:format=duration,format_name",
             "-of", "json", path],
            capture_output=True, text=True, timeout=60,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise TranscodeError(f"ffprobe failed: {exc}") from exc
    if out.returncode != 0:
        raise TranscodeError(f"ffprobe rc={out.returncode}: {out.stderr[:300]}")

    data = json.loads(out.stdout or "{}")
    v_codec = a_codec = None
    height = None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video" and v_codec is None:
            v_codec = stream.get("codec_name")
            height = stream.get("height")
        elif stream.get("codec_type") == "audio" and a_codec is None:
            a_codec = stream.get("codec_name")
    fmt = data.get("format", {})
    dur_raw = fmt.get("duration")
    duration = round(float(dur_raw)) if dur_raw else None
    faststart = _probe_faststart(path)
    return ProbeResult(
        video_codec=v_codec,
        audio_codec=a_codec,
        height=height,
        duration=duration,
        faststart=faststart,
    )


def _probe_faststart(path: str) -> bool:
    """faststart = moov-атом лежит ПЕРЕД mdat (иначе плеер ждёт полной докачки).

    ffprobe этого прямо не отдаёт; читаем порядок верхнеуровневых боксов mp4 из начала
    файла. Не-mp4 (webm/mov без нужной раскладки) → False (транскодим). Best-effort:
    любая ошибка чтения → False (безопаснее перекодировать, чем отдать не-стриминговый).
    """
    try:
        with open(path, "rb") as fh:
            head = fh.read(1_000_000)  # moov обычно в первых сотнях КБ, если он спереди
    except OSError:
        return False
    moov = head.find(b"moov")
    mdat = head.find(b"mdat")
    if moov == -1:
        return False  # moov не в начале файла — не faststart
    if mdat == -1:
        return True   # moov найден, mdat дальше по файлу — moov впереди
    return moov < mdat


def _needs_transcode(probe: ProbeResult) -> bool:
    """Fast-path: уже H.264 + AAC + faststart + высота ≤ 720 → транскодить не нужно."""
    return not (
        probe.video_codec == "h264"
        and probe.audio_codec == "aac"
        and probe.faststart
        and probe.height is not None
        and probe.height <= _TARGET_MAX_HEIGHT
    )


def _download(bucket: str, key: str, dst: str) -> int:
    """Скачать объект из MinIO в локальный файл; вернуть размер (байты)."""
    client = _server_client()
    obj = client.get_object(Bucket=bucket, Key=key)
    total = 0
    with open(dst, "wb") as fh:
        for chunk in obj["Body"].iter_chunks(1024 * 1024):
            fh.write(chunk)
            total += len(chunk)
    return total


def _run_ffmpeg_720p(src: str, dst: str) -> None:
    """Перекодировать в H.264 720p, AAC 128k, +faststart. Бросает TranscodeError.

    scale=-2:min(720,ih) — не апскейлим (min с исходной высотой), -2 держит чётную
    ширину (libx264 требует чётные размеры). preset veryfast / crf 23 — из спеки.
    """
    cmd = [
        "ffmpeg", "-v", "error", "-y", "-i", src,
        "-vf", "scale=-2:min(720\\,ih)",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        dst,
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True,
            timeout=settings.transcode_ffmpeg_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise TranscodeError("ffmpeg timed out") from exc
    except (subprocess.SubprocessError, OSError) as exc:
        raise TranscodeError(f"ffmpeg failed to launch: {exc}") from exc
    if proc.returncode != 0:
        raise TranscodeError(
            f"ffmpeg rc={proc.returncode}: "
            f"{proc.stderr[:500].decode('utf-8', 'replace')}"
        )


def _extract_poster(src: str, duration: int | None) -> bytes | None:
    """Постер-кадр (JPEG-путь через PNG → WebP как у превью картинок). None при сбоя.

    Кадр на 1-й секунде (первый часто чёрный); для совсем коротких — с нуля. Best-
    effort: постер не критичен, его отсутствие не роняет транскод.
    """
    seek = "0" if duration is not None and duration < 2 else "1"
    try:
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", seek, "-i", src,
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
            capture_output=True, timeout=120,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        return _encode_webp_thumbnail(proc.stdout)
    except Exception:
        return None


@dataclass
class TranscodeResult:
    """Итог транскода: ключи варианта/постера + мета для media_assets."""

    variant_key: str
    variant_mime: str
    poster_key: str | None
    duration: int | None


def transcode_asset(bucket: str, storage_key: str) -> TranscodeResult:
    """Полный прогон над одним видео-объектом. Бросает TranscodeError → джоба ретраится.

    Шаги: скачать → гардрейлы (размер/длительность) → ffprobe → fast-path ИЛИ ffmpeg
    720p → залить вариант → постер → залить постер. Оригинал в MinIO не трогаем.
    fast-path: variant_key = storage_key (отдаём тот же объект, он уже совместим).
    """
    if not storage_key:
        raise TranscodeError("empty storage_key")

    src_path: str | None = None
    dst_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".src", delete=False) as tmp:
            src_path = tmp.name
        size = _download(bucket, storage_key, src_path)
        if size > settings.transcode_max_source_bytes:
            raise TranscodeError(
                f"source too large: {size} > {settings.transcode_max_source_bytes}"
            )

        probe = _ffprobe(src_path)
        if (
            probe.duration is not None
            and probe.duration > settings.transcode_max_duration_seconds
        ):
            raise TranscodeError(
                f"source too long: {probe.duration}s > "
                f"{settings.transcode_max_duration_seconds}s"
            )

        client = _server_client()
        if _needs_transcode(probe):
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                dst_path = tmp.name
            _run_ffmpeg_720p(src_path, dst_path)
            variant_key = build_variant_key(storage_key)
            with open(dst_path, "rb") as fh:
                client.put_object(
                    Bucket=bucket, Key=variant_key,
                    Body=fh, ContentType=VARIANT_MIME,
                )
            poster_src = dst_path
        else:
            # Fast-path: исходник уже совместим — отдаём его же как вариант, ffmpeg не
            # гоняем. Постер всё равно снимаем (для ленты/processing-плейсхолдера).
            variant_key = storage_key
            poster_src = src_path

        poster_key: str | None = None
        poster_bytes = _extract_poster(poster_src, probe.duration)
        if poster_bytes is not None:
            poster_key = build_thumb_key(storage_key)
            client.put_object(
                Bucket=bucket, Key=poster_key,
                Body=poster_bytes, ContentType="image/webp",
            )

        return TranscodeResult(
            variant_key=variant_key,
            variant_mime=VARIANT_MIME,
            poster_key=poster_key,
            duration=probe.duration,
        )
    finally:
        for path in (src_path, dst_path):
            if path and os.path.exists(path):
                os.unlink(path)
