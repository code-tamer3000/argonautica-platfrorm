"""Все модели SQLAlchemy.

Импортируются здесь, чтобы `Base.metadata` содержал каждую таблицу — это нужно
Alembic для autogenerate (env.py делает `import app.models`).
"""
from app.models.calendar import CalendarEvent
from app.models.journal import JournalPardon
from app.models.kb import KbCategory, KbComment, KbItem, KbItemMedia
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment, PinnedMessage
from app.models.room import Room, RoomMember
from app.models.sticker import Sticker, Stickerpack
from app.models.user import User

__all__ = [
    "User",
    "Room",
    "RoomMember",
    "Message",
    "MessageAttachment",
    "PinnedMessage",
    "MediaAsset",
    "Stickerpack",
    "Sticker",
    "KbCategory",
    "KbItem",
    "KbItemMedia",
    "KbComment",
    "CalendarEvent",
    "JournalPardon",
]
