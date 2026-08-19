"""intakes.ends_on + intake_id/plan links on rooms/tasks/kb_items (ARG-96)

Revision ID: 8f3c1a9d5e21
Revises: 51826f18440c
Create Date: 2026-08-19 11:00:00

Окно набора: `intakes.ends_on` (дата закрытия). Исторический набор был засеян
migration 535fcf72a060 с ошибочной `starts_on = 2026-06-02` — правильная дата,
подтверждённая пользователем заново, `starts_on = 2026-07-02`, `ends_on =
2026-07-29`. Правим обе колонки одной командой по старому значению (единственная
существующая строка на момент этой миграции).

Изоляция контента по потоку: `intake_id` (nullable FK на intakes) на `rooms`,
`tasks`, `kb_items`. NULL = «общий для всех потоков». Бэкфилл — весь
существующий административный контент привязывается к историческому набору,
КРОМЕ новостного канала (`rooms.is_news`, singleton, кросс-поточный намеренно) и
личных дневников (`rooms.is_personal`) — они привязаны к пользователю, а не к
потоку (пользователь уже привязан к набору через `users.intake_id`).

Изоляция по тарифу: связь многие-ко-многим (`<entity>_plans`), а не колонка —
пустой набор строк = материал доступен всем тарифам потока. Бэкфилл не нужен:
у существующего контента строк не будет, то есть тарифы не сужены.

Expand-only: все новые колонки/таблицы nullable/пустые, старый код их не знает и
не ломается.
"""
import sqlalchemy as sa

from alembic import op

revision = "8f3c1a9d5e21"
down_revision = "51826f18440c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- окно набора -----------------------------------------------------
    op.add_column("intakes", sa.Column("ends_on", sa.Date(), nullable=True))
    op.execute(
        """
        UPDATE intakes
        SET starts_on = '2026-07-02', ends_on = '2026-07-29'
        WHERE starts_on = '2026-06-02'
        """
    )
    # Любой другой уже существующий набор (тестовые/прочие среды могли насеять их
    # до этой миграции) получает дефолт starts_on+28д — сама дата продуктового
    # значения не несёт, только снимает NOT NULL для строк вне исторической.
    op.execute(
        """
        UPDATE intakes
        SET ends_on = starts_on + 28
        WHERE ends_on IS NULL
        """
    )
    op.alter_column("intakes", "ends_on", nullable=False)

    # --- intake_id на контенте --------------------------------------------
    op.add_column("rooms", sa.Column("intake_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "rooms_intake_id_fkey", "rooms", "intakes", ["intake_id"], ["id"]
    )
    op.add_column("tasks", sa.Column("intake_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "tasks_intake_id_fkey", "tasks", "intakes", ["intake_id"], ["id"]
    )
    op.add_column("kb_items", sa.Column("intake_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "kb_items_intake_id_fkey", "kb_items", "intakes", ["intake_id"], ["id"]
    )

    # Бэкфилл на самый ранний (исторический) набор.
    op.execute(
        """
        UPDATE rooms
        SET intake_id = (SELECT id FROM intakes ORDER BY starts_on ASC LIMIT 1)
        WHERE type = 'channel' AND is_news = false AND is_personal = false
        """
    )
    op.execute(
        """
        UPDATE tasks
        SET intake_id = (SELECT id FROM intakes ORDER BY starts_on ASC LIMIT 1)
        """
    )
    op.execute(
        """
        UPDATE kb_items
        SET intake_id = (SELECT id FROM intakes ORDER BY starts_on ASC LIMIT 1)
        """
    )

    # --- связь многие-ко-многим с тарифами ---------------------------------
    op.create_table(
        "room_plans",
        sa.Column("room_id", sa.BigInteger(), nullable=False),
        sa.Column("plan_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"]),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
        sa.PrimaryKeyConstraint("room_id", "plan_id"),
    )
    op.create_table(
        "task_plans",
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("plan_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
        sa.PrimaryKeyConstraint("task_id", "plan_id"),
    )
    op.create_table(
        "kb_item_plans",
        sa.Column("kb_item_id", sa.BigInteger(), nullable=False),
        sa.Column("plan_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["kb_item_id"], ["kb_items.id"]),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
        sa.PrimaryKeyConstraint("kb_item_id", "plan_id"),
    )


def downgrade() -> None:
    op.drop_table("kb_item_plans")
    op.drop_table("task_plans")
    op.drop_table("room_plans")

    op.drop_constraint("kb_items_intake_id_fkey", "kb_items", type_="foreignkey")
    op.drop_column("kb_items", "intake_id")
    op.drop_constraint("tasks_intake_id_fkey", "tasks", type_="foreignkey")
    op.drop_column("tasks", "intake_id")
    op.drop_constraint("rooms_intake_id_fkey", "rooms", type_="foreignkey")
    op.drop_column("rooms", "intake_id")

    op.alter_column("intakes", "ends_on", nullable=True)
    op.drop_column("intakes", "ends_on")
