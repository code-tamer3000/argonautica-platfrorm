"""Все модели SQLAlchemy.

Импортируются здесь, чтобы `Base.metadata` содержал каждую таблицу — это нужно
Alembic для autogenerate (env.py делает `import app.models`).
"""
from app.models.cabin import CabinEntry
from app.models.calendar import CalendarEvent
from app.models.faq import FaqItem
from app.models.feedback import Feedback
from app.models.journal import JournalCredit, JournalPardon
from app.models.kb import KbCategory, KbComment, KbItem, KbItemMedia
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment, PinnedMessage
from app.models.notification import Notification
from app.models.room import Room, RoomMember
from app.models.sticker import Sticker, Stickerpack
from app.models.task import (
    Task,
    TaskAssignment,
    TaskComment,
    TaskSubmission,
    TaskSubmissionMedia,
)
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
    "CabinEntry",
    "CalendarEvent",
    "FaqItem",
    "Feedback",
    "JournalPardon",
    "JournalCredit",
    "Notification",
    "Task",
    "TaskAssignment",
    "TaskSubmission",
    "TaskSubmissionMedia",
    "TaskComment",
]
