"""Все модели SQLAlchemy.

Импортируются здесь, чтобы `Base.metadata` содержал каждую таблицу — это нужно
Alembic для autogenerate (env.py делает `import app.models`).
"""
from app.models.cabin import CabinEntry
from app.models.calendar import CalendarEvent
from app.models.expedition import ExpeditionLock, IntakeStage
from app.models.faq import FaqItem
from app.models.feedback import Feedback
from app.models.intake import Intake
from app.models.intake_application import IntakeApplication
from app.models.journal import (
    JournalCredit,
    JournalPardon,
    JournalProgram,
    JournalSection,
)
from app.models.kb import KbCategory, KbComment, KbItem, KbItemMedia, KbItemPlan
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment, PinnedMessage
from app.models.notification import Notification
from app.models.plan import Plan
from app.models.push import PushSubscription
from app.models.room import Room, RoomMember, RoomPlan
from app.models.sticker import Sticker, Stickerpack
from app.models.survey import SurveyResponse
from app.models.task import (
    Task,
    TaskAssignment,
    TaskComment,
    TaskMedia,
    TaskPlan,
    TaskSubmission,
    TaskSubmissionMedia,
)
from app.models.user import User

__all__ = [
    "User",
    "Room",
    "RoomMember",
    "RoomPlan",
    "Message",
    "MessageAttachment",
    "PinnedMessage",
    "MediaAsset",
    "Stickerpack",
    "Sticker",
    "KbCategory",
    "KbItem",
    "KbItemMedia",
    "KbItemPlan",
    "KbComment",
    "CabinEntry",
    "CalendarEvent",
    "FaqItem",
    "Feedback",
    "Intake",
    "IntakeApplication",
    "IntakeStage",
    "ExpeditionLock",
    "Plan",
    "JournalPardon",
    "JournalCredit",
    "JournalProgram",
    "JournalSection",
    "Notification",
    "SurveyResponse",
    "PushSubscription",
    "Task",
    "TaskAssignment",
    "TaskMedia",
    "TaskPlan",
    "TaskSubmission",
    "TaskSubmissionMedia",
    "TaskComment",
]
