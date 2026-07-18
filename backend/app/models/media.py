"""Метаданные файлов. Байты — в MinIO; здесь только метаданные и ссылка на объект."""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MediaAsset(Base):
    """Централизованное хранилище метаданных. Публичный URL НЕ хранится (presigned)."""

    __tablename__ = "media_assets"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('image', 'video', 'file', 'audio')", name="kind_valid"
        ),
        CheckConstraint(
            "transcode_status IS NULL OR transcode_status IN "
            "('processing', 'done', 'failed')",
            name="transcode_status_valid",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bucket: Mapped[str] = mapped_column(Text, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Ключ уменьшенного превью в том же бакете (для картинок; None — превью нет:
    # старые записи, видео/файлы, либо не сгенерировалось). В ленте отдаём превью,
    # оригинал — только по клику/скачиванию. Генерится best-effort при подтверждении.
    thumb_key: Mapped[str | None] = mapped_column(Text)
    # Ключ WebP-деривата среднего размера (≤PREVIEW_MAX_PX по длинной стороне) — то,
    # что открывает лайтбокс вместо оригинала: на проде 90% медиа-трафика составляли
    # полноразмерные исходники (реальный случай — JPG на 11 МБ ради одного просмотра).
    # Только для kind='image'; у видео/файлов NULL. NULL также у легаси-строк, при
    # неудачной генерации и когда дериват вышел не легче оригинала (маленькая картинка)
    # — во всех этих случаях клиент откатывается на оригинал (`url`).
    preview_key: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)  # байты
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration: Mapped[int | None] = mapped_column(Integer)  # секунды, для видео
    # Серверный транскод видео (docs/FILES.md «Транскод видео»). Только для kind=video;
    # у остального NULL. Живой прогресс/попытки джобы — эфемерно в Redis; здесь ТОЛЬКО
    # долговечное состояние отдачи, которое должен знать attachment-payload и после
    # истечения Redis-джобы:
    #   'processing' — оригинал залит, вариант ещё готовится (клиент рисует спиннер);
    #   'done'       — вариант готов, отдаём его (variant_key может = storage_key на
    #                  fast-path, когда исходник уже H.264/AAC/faststart/≤720p);
    #   'failed'     — транскод не удался после ретраев, отдаём оригинал как файл.
    # NULL — транскод неприменим (не видео) ИЛИ легаси-строка до этой фичи: такие
    # видео отдаём как раньше (оригинал), фронт со stale-состоянием их всё равно рисует.
    transcode_status: Mapped[str | None] = mapped_column(Text)
    # Ключ отдаваемого H.264 720p mp4 (`video/720/<uuid>.mp4`); на fast-path = storage_key.
    variant_key: Mapped[str | None] = mapped_column(Text)
    variant_mime: Mapped[str | None] = mapped_column(Text)  # обычно video/mp4
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
