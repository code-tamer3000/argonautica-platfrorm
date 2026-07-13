"""База знаний (SPEC §4.9): авторский CRUD материалов + чтение опубликованного.

Материалы создаёт/правит только admin; участники читают опубликованное. Категории —
плоские (один уровень): CRUD только admin, любой участник видит список категорий для
группировки материалов. Файлы/видео грузятся обычным media-flow (`/api/media/...`)
и линкуются к материалу. Авторизация на КАЖДОМ запросе (CLAUDE.md п.1).
"""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin
from app.db.session import get_session
from app.models.kb import KbCategory, KbComment, KbItem, KbItemMedia
from app.models.media import MediaAsset
from app.models.user import User
from app.schemas.kb import (
    AttachMediaRequest,
    KbCategoryCreate,
    KbCategoryOut,
    KbCategoryUpdate,
    KbCommentCreate,
    KbCommentOut,
    KbItemCreate,
    KbItemOut,
    KbItemUpdate,
)
from app.services.kb import (
    assert_category_exists,
    assert_kb_item_visible,
    attached_media_ids,
    load_kb_item,
)

router = APIRouter(prefix="/api/kb", tags=["kb"])

# Поля, которые admin вправе править через PATCH.
_PATCHABLE_FIELDS = {"title", "body", "published", "category_id", "sort_order"}


def _to_out(item: KbItem, media_ids: list[int]) -> KbItemOut:
    out = KbItemOut.model_validate(item)
    out.media_asset_ids = media_ids
    return out


async def _assert_assets_exist(session: AsyncSession, asset_ids: list[int]) -> None:
    """Все переданные media_asset_id должны существовать, иначе 404."""
    if not asset_ids:
        return
    found = await session.execute(
        select(MediaAsset.id).where(MediaAsset.id.in_(asset_ids))
    )
    if set(found.scalars().all()) != set(asset_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media asset not found")


# --- категории (плоские) ----------------------------------------------------


@router.get("/categories", response_model=list[KbCategoryOut])
async def list_categories(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[KbCategory]:
    """Список категорий для группировки. Виден любому участнику."""
    rows = await session.execute(
        select(KbCategory).order_by(KbCategory.sort_order, KbCategory.id)
    )
    return list(rows.scalars().all())


@router.post("/categories", response_model=KbCategoryOut, status_code=201)
async def create_category(
    body: KbCategoryCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbCategory:
    """Создать категорию (admin)."""
    category = KbCategory(title=body.title, sort_order=body.sort_order)
    session.add(category)
    await session.flush()
    await session.refresh(category)
    return category


@router.patch("/categories/{category_id}", response_model=KbCategoryOut)
async def update_category(
    category_id: int,
    body: KbCategoryUpdate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbCategory:
    """Частичное обновление категории (admin)."""
    category = await session.get(KbCategory, category_id)
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KB category not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    await session.flush()
    return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить категорию (admin). Материалы не удаляются — их `category_id` → NULL."""
    category = await session.get(KbCategory, category_id)
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KB category not found")
    # Отвязываем материалы, иначе FK не даст удалить категорию.
    await session.execute(
        update(KbItem)
        .where(KbItem.category_id == category_id)
        .values(category_id=None)
    )
    await session.delete(category)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- авторские эндпоинты (только admin) ------------------------------------


@router.post("/items", response_model=KbItemOut, status_code=201)
async def create_item(
    body: KbItemCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbItemOut:
    """Создать материал (по умолчанию черновик). Опционально привязать медиа."""
    await _assert_assets_exist(session, body.media_asset_ids)
    await assert_category_exists(session, body.category_id)

    item = KbItem(
        title=body.title,
        body=body.body,
        published=body.published,
        category_id=body.category_id,
        created_by=current_admin.id,
    )
    session.add(item)
    await session.flush()

    for asset_id in dict.fromkeys(body.media_asset_ids):  # без дублей
        session.add(KbItemMedia(kb_item_id=item.id, media_asset_id=asset_id))
    await session.flush()
    await session.refresh(item)

    media_ids = (await attached_media_ids(session, [item.id])).get(item.id, [])
    return _to_out(item, media_ids)


@router.patch("/items/{item_id}", response_model=KbItemOut)
async def update_item(
    item_id: int,
    body: KbItemUpdate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbItemOut:
    """Частичное обновление: применяем только переданные whitelisted-поля."""
    item = await load_kb_item(session, item_id)

    changes = body.model_dump(exclude_unset=True)
    if "category_id" in changes:
        await assert_category_exists(session, changes["category_id"])
    for field, value in changes.items():
        if field in _PATCHABLE_FIELDS:
            setattr(item, field, value)
    if changes:
        item.updated_at = datetime.now(UTC)
    await session.flush()

    media_ids = (await attached_media_ids(session, [item.id])).get(item.id, [])
    return _to_out(item, media_ids)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить материал и его связи с медиа (физически — у kb_items нет deleted_at)."""
    item = await load_kb_item(session, item_id)

    # Сначала дочерние связи (явный bulk-DELETE), затем сам материал — иначе FK.
    await session.execute(
        sa_delete(KbItemMedia).where(KbItemMedia.kb_item_id == item_id)
    )
    await session.delete(item)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/items/{item_id}/media", response_model=KbItemOut)
async def attach_media(
    item_id: int,
    body: AttachMediaRequest,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbItemOut:
    """Привязать медиа к материалу (идемпотентно). 404, если ассета нет."""
    item = await load_kb_item(session, item_id)
    await _assert_assets_exist(session, body.media_asset_ids)

    for asset_id in dict.fromkeys(body.media_asset_ids):
        if await session.get(KbItemMedia, (item_id, asset_id)) is None:
            session.add(KbItemMedia(kb_item_id=item_id, media_asset_id=asset_id))
    await session.flush()

    media_ids = (await attached_media_ids(session, [item.id])).get(item.id, [])
    return _to_out(item, media_ids)


@router.delete("/items/{item_id}/media/{media_asset_id}", status_code=204)
async def detach_media(
    item_id: int,
    media_asset_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Отвязать медиа от материала. 404, если связи нет."""
    await load_kb_item(session, item_id)

    link = await session.get(KbItemMedia, (item_id, media_asset_id))
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media not attached to this item")
    await session.delete(link)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- чтение (любой активный участник) --------------------------------------


@router.get("/items", response_model=list[KbItemOut])
async def list_items(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[KbItemOut]:
    """Список материалов: участник — только опубликованные; admin — все."""
    stmt = select(KbItem).order_by(KbItem.sort_order, KbItem.created_at)
    if current_user.role != "admin":
        stmt = stmt.where(KbItem.published.is_(True))

    items = list((await session.execute(stmt)).scalars().all())
    media = await attached_media_ids(session, [i.id for i in items])
    return [_to_out(i, media.get(i.id, [])) for i in items]


@router.get("/items/{item_id}", response_model=KbItemOut)
async def get_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbItemOut:
    """Один материал. Черновик виден только admin (иначе 404)."""
    item = await load_kb_item(session, item_id)
    assert_kb_item_visible(item, current_user)

    media_ids = (await attached_media_ids(session, [item.id])).get(item.id, [])
    return _to_out(item, media_ids)


# --- комментарии участников (плоские, п.2) ---------------------------------


@router.get("/items/{item_id}/comments", response_model=list[KbCommentOut])
async def list_comments(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[KbComment]:
    """Комментарии материала (без удалённых), по возрастанию времени.

    Видимость комментариев = видимость материала: черновик — только admin (404).
    """
    item = await load_kb_item(session, item_id)
    assert_kb_item_visible(item, current_user)

    rows = await session.execute(
        select(KbComment)
        .where(KbComment.kb_item_id == item_id, KbComment.deleted_at.is_(None))
        .order_by(KbComment.created_at, KbComment.id)
    )
    return list(rows.scalars().all())


@router.post("/items/{item_id}/comments", response_model=KbCommentOut, status_code=201)
async def create_comment(
    item_id: int,
    body: KbCommentCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbComment:
    """Оставить комментарий. Может любой участник, кто видит материал."""
    item = await load_kb_item(session, item_id)
    assert_kb_item_visible(item, current_user)

    comment = KbComment(
        kb_item_id=item_id,
        author_id=current_user.id,
        body=body.body,
    )
    session.add(comment)
    await session.flush()
    await session.refresh(comment)
    return comment


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Мягко удалить комментарий: автор комментария или admin (п.6)."""
    comment = await session.get(KbComment, comment_id)
    if comment is None or comment.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    if comment.author_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")

    comment.deleted_at = datetime.now(UTC)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
