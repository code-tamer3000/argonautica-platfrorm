"""Тесты выборки кандидатов для бэкфила деривативов.

`backend/scripts/backfill_media_derivatives.py` резюмируем ровно за счёт того, что
кандидаты вычисляются из состояния БД (`transcode_status`/`variant_key`/`preview_key`),
а не из внешнего файла прогресса. Это и проверяем на реальном Postgres из тестового
стека: догнанные объекты из выборки исчезают, недоделанные — остаются.

Скрипт лежит в `scripts/` (не пакет `app`), поэтому подгружаем его по пути.
"""
import importlib.util
import sys
import uuid
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.user import User

from .conftest import MakeUser


def _load_script() -> ModuleType:
    path = Path(__file__).resolve().parent.parent / "scripts" / "backfill_media_derivatives.py"
    spec = importlib.util.spec_from_file_location("backfill_media_derivatives", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # Регистрируем ДО exec_module: @dataclass со строковыми аннотациями
    # (`from __future__ import annotations`) резолвит их через sys.modules[__module__].
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


backfill = _load_script()


async def _asset(session: AsyncSession, owner: User, **kwargs: object) -> MediaAsset:
    fields: dict[str, object] = {
        "bucket": "media",
        "storage_key": f"2026/07/{uuid.uuid4().hex}",
        "kind": "image",
        "mime_type": "image/jpeg",
        "size": 1234,
        "created_by": owner.id,
    }
    fields.update(kwargs)
    asset = MediaAsset(**fields)
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


@pytest.mark.asyncio
async def test_video_candidates_only_legacy_rows(
    session: AsyncSession, make_user: MakeUser
) -> None:
    owner = await make_user()
    legacy = await _asset(session, owner, kind="video", mime_type="video/mp4")
    processing = await _asset(
        session, owner, kind="video", mime_type="video/mp4",
        transcode_status="processing",
    )
    done = await _asset(
        session, owner, kind="video", mime_type="video/mp4",
        transcode_status="done", variant_key="video/720/x.mp4",
    )
    failed = await _asset(
        session, owner, kind="video", mime_type="video/mp4",
        transcode_status="failed",
    )

    ids = {a.id for a in await backfill.select_video_candidates(session)}
    # Легаси (status NULL) — берём; живая загрузка и готовое — нет.
    assert legacy.id in ids
    assert processing.id not in ids
    assert done.id not in ids
    assert failed.id not in ids

    # --retry-failed добавляет только провалившиеся.
    retry_ids = {
        a.id for a in await backfill.select_video_candidates(session, retry_failed=True)
    }
    assert {legacy.id, failed.id} <= retry_ids
    assert done.id not in retry_ids


@pytest.mark.asyncio
async def test_video_candidate_disappears_once_done(
    session: AsyncSession, make_user: MakeUser
) -> None:
    """Резюмируемость: доведённое до 'done' видео на следующем прогоне не берётся."""
    owner = await make_user()
    asset = await _asset(session, owner, kind="video", mime_type="video/mp4")
    assert asset.id in {a.id for a in await backfill.select_video_candidates(session)}

    asset.transcode_status = "done"
    asset.variant_key = "video/720/y.mp4"
    await session.commit()

    assert asset.id not in {
        a.id for a in await backfill.select_video_candidates(session)
    }


@pytest.mark.asyncio
async def test_image_candidates_and_limit(
    session: AsyncSession, make_user: MakeUser
) -> None:
    owner = await make_user()
    without = await _asset(session, owner)
    with_preview = await _asset(session, owner, preview_key="previews/a.webp")
    a_video = await _asset(session, owner, kind="video", mime_type="video/mp4")

    ids = {a.id for a in await backfill.select_image_candidates(session)}
    assert without.id in ids
    assert with_preview.id not in ids
    assert a_video.id not in ids

    # --limit ограничивает прогон (владелец сначала гоняет 3 штуки и смотрит).
    assert len(await backfill.select_image_candidates(session, limit=2)) <= 2
