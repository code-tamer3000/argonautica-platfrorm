"""Задачи (SPEC: раздел «Задачи»): общие/индивидуальные + сдачи, комментарии, ревью.

Задача либо общая (`type='common'` — видна всем активным участникам, каждый может
сдать), либо индивидуальная (`type='individual'` — адресована конкретным юзерам через
`task_assignments`). Сдачи (`task_submissions`) несут текст и медиа-вложения (через
общую `media_assets`). Ревью админа меняет статус назначения; при возврате пишется
комментарий на последнюю сдачу. Мягкое удаление задач/комментариев (deleted_at, п.6).
Дедлайн-события синхронизируются в `calendar_events` (см. services/tasks.py).
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Task(Base):
    """Задача автора. `type` различает общую/индивидуальную/парную/поток (поведение — в коде).

    `pair` — родительское парное задание (взаимное обучение): админ распределяет
    участников по парам (task_pairs); у каждого участника пары — своё назначение,
    закрывающееся, когда обе перекрёстные задачи пары приняты. Перекрёстная задача —
    обычная `individual` с `created_by`=участник и `pair_id`, указывающим на пару.

    `stream` — «поток»: турнирная сетка слияний (task_streams / task_stream_nodes).
    Участники пишут личный текст, подгруппа утверждает общую фразу, подгруппы
    сливаются вдвое — и так до корня. См. services/stream.py и docs/TASKS.md.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "type IN ('common', 'individual', 'pair', 'stream')", name="task_type_valid"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)  # markdown
    # Опциональная привязка к материалу базы знаний.
    kb_item_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("kb_items.id")
    )
    # Для перекрёстной задачи (individual внутри пары) — пара, к которой она относится.
    # NULL у всех обычных задач. Связывает выданную задачу с парой (видимость, завершение).
    pair_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("task_pairs.id")
    )
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # мягкое удаление


class TaskPair(Base):
    """Пара внутри парного задания (task.type='pair'). Ровно 2 участника (см.
    TaskPairMember). Встреча — одна на пару, информационная (дата+время), без
    уведомлений; управляет ей один участник (meeting_organizer_id, выбран случайно).
    Мягкое удаление (deleted_at) — админ вправе расформировать пару.
    """

    __tablename__ = "task_pairs"
    __table_args__ = (Index("ix_task_pairs_task", "task_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), nullable=False
    )
    # Кто управляет встречей (один из двух участников, выбран случайно при создании).
    meeting_organizer_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    meeting_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskPairMember(Base):
    """Членство участника в паре. UNIQUE(task_id, user_id) гарантирует: один человек —
    максимум в одной паре в пределах одного парного задания (снимает симметрию a/b).
    """

    __tablename__ = "task_pair_members"
    __table_args__ = (
        UniqueConstraint("task_id", "user_id", name="uq_task_pair_member"),
        Index("ix_task_pair_members_pair", "pair_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    pair_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_pairs.id"), nullable=False
    )
    # Денормализованный task_id — нужен для UNIQUE(task_id, user_id) на уровне БД.
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )


class TaskStream(Base):
    """Конфиг потока (task.type='stream'), 1:1 с задачей.

    `stage` — позиция в лестнице стадий: чётная = все пишут свой текст, нечётная =
    подгруппы раунда `(stage+1)//2` утверждают общую фразу. Всего стадий `2*depth+1`.
    Дедлайн ТЕКУЩЕЙ стадии живёт в `tasks.deadline_at` (переиспользуем календарь).
    """

    __tablename__ = "task_streams"
    __table_args__ = (UniqueConstraint("task_id", name="uq_task_stream_task"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), nullable=False
    )
    stage: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Число раундов слияния: 16 участников → 4 (пары, четвёрки, восьмёрки, корень).
    depth: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskStreamNode(Base):
    """Узел турнирной сетки: подгруппа, утверждающая одну общую фразу.

    Дерево через `parent_id` (NULL у корня). `side`/`position` — чисто раскладка канвы
    (8 слева, 8 справа, сходятся к центру). `room_id` — group-комната обсуждения,
    создаётся лениво при открытии раунда. Фраза утверждена, когда все члены узла
    проголосовали за один вариант (`approved_by` NULL) либо её продавил админ.
    """

    __tablename__ = "task_stream_nodes"
    __table_args__ = (
        CheckConstraint("side IN ('left', 'right')", name="task_stream_node_side_valid"),
        Index("ix_task_stream_nodes_task", "task_id"),
        Index("ix_task_stream_nodes_room", "room_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), nullable=False
    )
    # 1 = пары, 2 = четвёрки, … depth = корень.
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("task_stream_nodes.id")
    )
    side: Mapped[str | None] = mapped_column(Text)  # NULL у корня
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    room_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("rooms.id"))
    phrase: Mapped[str | None] = mapped_column(Text)
    phrase_option_id: Mapped[int | None] = mapped_column(BigInteger)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # NULL = утверждено единогласным голосованием; иначе id админа, продавившего фразу.
    approved_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskStreamNodeMember(Base):
    """Членство в узле. Денормализовано на ВСЕ раунды (участник лежит в узле каждого
    раунда), чтобы «кто в узле» и «в каком узле раунда r этот юзер» были одним запросом —
    от этого зависит вся проверка видимости (anti-IDOR).
    """

    __tablename__ = "task_stream_node_members"
    __table_args__ = (
        UniqueConstraint("node_id", "user_id", name="uq_task_stream_node_member"),
        Index("ix_task_stream_node_members_user", "task_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    node_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_stream_nodes.id"), nullable=False
    )
    # Денормализованный task_id — для выборки «все узлы юзера в этом потоке».
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )


class TaskStreamText(Base):
    """Версия личного текста участника. `version` 0 — исходный, дальше по одной на
    каждый раунд слияния (последняя = финальный текст). Правится до закрытия стадии,
    поэтому UPDATE строки, а не история (в отличие от task_submissions).
    """

    __tablename__ = "task_stream_texts"
    __table_args__ = (
        UniqueConstraint("task_id", "user_id", "version", name="uq_task_stream_text"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaskStreamOption(Base):
    """Вариант-кандидат общей фразы, предложенный членом узла. Мягкое удаление."""

    __tablename__ = "task_stream_options"
    __table_args__ = (Index("ix_task_stream_options_node", "node_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    node_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_stream_nodes.id"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskStreamVote(Base):
    """Голос за вариант. UNIQUE(node_id, user_id) — один голос на человека в узле;
    переголосовать = UPDATE строки. Фраза утверждается при единогласии.
    """

    __tablename__ = "task_stream_votes"
    __table_args__ = (
        UniqueConstraint("node_id", "user_id", name="uq_task_stream_vote"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    node_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_stream_nodes.id"), nullable=False
    )
    option_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_stream_options.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaskMedia(Base):
    """Связь задачи с файлами/видео описания (через общую media_assets).

    Медиа самого условия задачи (создаёт/правит admin), зеркало TaskSubmissionMedia.
    """

    __tablename__ = "task_media"

    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), primary_key=True
    )
    media_asset_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("media_assets.id"), primary_key=True
    )


class TaskAssignment(Base):
    """Назначение задачи юзеру + жизненный цикл сдачи.

    Для индивидуальных задач строки создаём при создании задачи. Для общих —
    лениво при первой сдаче (вариант «неявного доступа», как каналы, п.3).
    """

    __tablename__ = "task_assignments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('assigned', 'submitted', 'returned', 'accepted')",
            name="task_assignment_status_valid",
        ),
        UniqueConstraint("task_id", "user_id", name="uq_task_assignment"),
        Index("ix_task_assignments_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tasks.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="assigned"
    )
    # Сдано после дедлайна (проставляется на первой сдаче).
    late: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaskSubmission(Base):
    """Одна сдача по назначению. История сдач сохраняется (возврат → новая сдача)."""

    __tablename__ = "task_submissions"
    __table_args__ = (
        Index(
            "ix_task_submissions_assignment_created",
            "assignment_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_assignments.id"), nullable=False
    )
    body: Mapped[str | None] = mapped_column(Text)  # markdown
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaskSubmissionMedia(Base):
    """Связь сдачи с файлами/видео (через общую media_assets)."""

    __tablename__ = "task_submission_media"

    submission_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_submissions.id"), primary_key=True
    )
    media_asset_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("media_assets.id"), primary_key=True
    )


class TaskComment(Base):
    """Плоские комментарии под сдачей (ревью-фидбек). Мягкое удаление (п.6)."""

    __tablename__ = "task_comments"
    __table_args__ = (
        Index(
            "ix_task_comments_submission_created",
            "submission_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task_submissions.id"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
