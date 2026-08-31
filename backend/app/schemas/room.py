"""Pydantic-схемы комнат и членства."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

RoomType = Literal["dm", "group", "channel"]


class CreateRoomRequest(BaseModel):
    """Создание комнаты. Поля зависят от типа (валидируются в эндпоинте):
    dm → peer_id; group/channel → name. `intake_id`/`plan_ids` — только channel,
    админ-изоляция контента по потоку/тарифу (ARG-96); для остальных типов
    игнорируются.
    """

    type: RoomType
    name: str | None = None
    peer_id: int | None = None
    intake_id: int | None = None
    plan_ids: list[int] = []


class UpdateChannelRequest(BaseModel):
    """Правка канала (admin): название и изоляция по потоку/тарифу (ARG-96).

    `intake_id`/`plan_ids` отсутствуют в теле — не трогаем; переданы — заменяют
    целиком (null у intake_id = «общий для всех потоков», [] у plan_ids = «всем
    тарифам»).
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    intake_id: int | None = None
    plan_ids: list[int] | None = None


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    name: str | None
    avatar_url: str | None
    created_at: datetime
    unread_count: int = 0
    is_personal: bool = False
    is_news: bool = False
    created_by: int = 0
    peer_id: int | None = None  # заполняется только для type='dm'
    # Комната подгруппы потока: узел сетки и его задача. Клиент вешает на такую
    # комнату виджет голосования за общую фразу. None у обычных комнат.
    stream_node_id: int | None = None
    stream_task_id: int | None = None
    # Только channel: изоляция по потоку/тарифу (ARG-96), видна только admin-у
    # (список отдаёт эндпоинт get/create/update канала, не участнику).
    intake_id: int | None = None
    plan_ids: list[int] = []
    # Только is_personal: тариф ВЛАДЕЛЬЦА дневника (не «изоляция», а denormalized
    # ярлык), чтобы «Все дневники» можно было сгруппировать по тарифу без похода
    # в admin-only /api/admin/users. None — владелец без тарифа.
    owner_plan_id: int | None = None
    owner_plan_name: str | None = None
    # Только dm: одностороннее ограничение записи (ARG-110, часть B) — пир этой
    # dm-комнаты админ без is_navigator, а у смотрящего нет права ему писать
    # (не топ-2 тарифа потока). True — фронт скрывает композер; сервер 403-ит тот
    # же путь (assert_can_write) независимо от этого поля.
    dm_write_locked: bool = False


class AddMemberRequest(BaseModel):
    """Добавляемый — существующий юзер платформы (по id). Роль всегда 'member'."""

    user_id: int


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    room_id: int
    user_id: int
    role_in_room: str
    joined_at: datetime
