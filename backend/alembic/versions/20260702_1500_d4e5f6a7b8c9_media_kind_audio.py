"""allow audio media kind

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-02 15:00:00.000000

Голосовые сообщения — это аудио-ассеты в общем media_assets (не новая таблица).
Расширяем CHECK на `kind`: добавляем 'audio' к ('image','video','file').

Обратная совместимость (blue-green, п.8): миграция только РАСШИРЯЕТ множество
допустимых значений. Старый код такие строки не создаёт, поэтому и blue, и green
работают с этой схемой без конфликта. downgrade сузит обратно — безопасно лишь
пока audio-строк ещё нет (на момент отката их не будет).
"""
from collections.abc import Sequence

from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Бэйзовое имя constraint. Соглашение об именовании (metadata naming_convention)
# само добавит префикс `ck_media_assets_` — поэтому здесь имя БЕЗ префикса, иначе
# получим двойной `ck_media_assets_ck_media_assets_...`.
_CONSTRAINT = "kind_valid"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_media_assets_kind_valid"), "media_assets", type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        "media_assets",
        "kind IN ('image', 'video', 'file', 'audio')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_media_assets_kind_valid"), "media_assets", type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        "media_assets",
        "kind IN ('image', 'video', 'file')",
    )
