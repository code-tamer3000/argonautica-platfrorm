"""Раздел «Каюта»: личные записи участника (дневник эмоций, декатастрофизация,
триггеры) + админский просмотр записей участников.

Приватность (п.1 CLAUDE.md — авторизация на каждом запросе):
- список/создание/правка/удаление работают только с записями текущего пользователя
  (user_id берём из токена, не из тела — не доверяем клиенту).
- админский просмотр (`/api/cabin/admin/...`) — под require_admin.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin
from app.db.session import get_session
from app.models.cabin import CabinEntry
from app.models.user import User
from app.schemas.cabin import (
    AdminCabinEntryOut,
    CabinEntryCreate,
    CabinEntryOut,
    CabinKind,
)

router = APIRouter(prefix="/api/cabin", tags=["cabin"])


@router.get("/{kind}", response_model=list[CabinEntryOut])
async def list_entries(
    kind: CabinKind,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[CabinEntry]:
    """Записи текущего пользователя в подразделе `kind`, сначала новые."""
    rows = await session.scalars(
        select(CabinEntry)
        .where(CabinEntry.user_id == current_user.id, CabinEntry.kind == kind)
        .order_by(CabinEntry.created_at.desc())
    )
    return list(rows)


@router.post("/{kind}", status_code=status.HTTP_201_CREATED, response_model=CabinEntryOut)
async def create_entry(
    kind: CabinKind,
    body: CabinEntryCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CabinEntry:
    """Создать «плашку» в подразделе. `kind` в URL и в data должны совпадать."""
    if body.data.kind != kind:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind mismatch")
    entry = CabinEntry(
        user_id=current_user.id,
        kind=kind,
        data=body.data.model_dump(),
    )
    session.add(entry)
    await session.flush()
    return entry


@router.put("/{kind}/{entry_id}", response_model=CabinEntryOut)
async def update_entry(
    kind: CabinKind,
    entry_id: int,
    body: CabinEntryCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CabinEntry:
    """Заменить содержимое своей записи. Чужую/несуществующую — 404."""
    if body.data.kind != kind:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind mismatch")
    entry = await _own_entry(session, current_user.id, kind, entry_id)
    entry.data = body.data.model_dump()
    await session.flush()
    # onupdate=now() ставит updated_at на стороне БД — подтягиваем свежее значение,
    # иначе сериализация ответа полезет за ним ленивой IO вне async-контекста.
    await session.refresh(entry)
    return entry


@router.delete("/{kind}/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    kind: CabinKind,
    entry_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Удалить свою запись. Каюта — личное, физическое удаление (не soft-delete
    сообщений из п.6): восстанавливать личную психо-заметку смысла нет."""
    entry = await _own_entry(session, current_user.id, kind, entry_id)
    await session.delete(entry)


@router.get("/admin/{kind}", response_model=list[AdminCabinEntryOut])
async def admin_list_entries(
    kind: CabinKind,
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin)],
    user_id: int | None = None,
) -> list[AdminCabinEntryOut]:
    """Админский просмотр записей участников в подразделе. Можно сузить до user_id."""
    stmt = (
        select(CabinEntry, User.display_name, User.username)
        .join(User, User.id == CabinEntry.user_id)
        .where(CabinEntry.kind == kind)
        .order_by(CabinEntry.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(CabinEntry.user_id == user_id)
    rows = await session.execute(stmt)
    return [
        AdminCabinEntryOut(
            id=e.id,
            kind=e.kind,  # type: ignore[arg-type]
            data=e.data,
            created_at=e.created_at,
            updated_at=e.updated_at,
            user_id=e.user_id,
            display_name=display_name,
            username=username,
        )
        for e, display_name, username in rows.all()
    ]


async def _own_entry(
    session: AsyncSession, user_id: int, kind: str, entry_id: int
) -> CabinEntry:
    """Достать запись, убедившись, что она принадлежит пользователю и нужного kind."""
    entry = await session.get(CabinEntry, entry_id)
    if entry is None or entry.user_id != user_id or entry.kind != kind:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    return entry
