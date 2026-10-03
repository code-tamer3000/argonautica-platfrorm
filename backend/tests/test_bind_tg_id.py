"""Скрипт `bind_tg_id` (ARG-167): dry-run по умолчанию, отказы, уникальность tg_id."""
import importlib.util
import random
import sys
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake_application import STATUS_CONFIRMED, IntakeApplication
from app.models.user import User

from .conftest import MakeUser


def _load_script() -> ModuleType:
    path = Path(__file__).resolve().parent.parent / "scripts" / "bind_tg_id.py"
    spec = importlib.util.spec_from_file_location("bind_tg_id", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


bind = _load_script()


def new_tg_id() -> int:
    return random.randint(10**9, 10**12)


def test_read_rows_skips_unresolved_and_dedups(tmp_path: Path) -> None:
    csv_file = tmp_path / "r.csv"
    csv_file.write_text(
        "username,tg_id,first_name,last_name,status\n"
        "alice,111,A,,ok\n"
        "@bob,222,B,,ok (tg @bob_other; вручную)\n"
        "carol,,C,,not_found\n"
        "dave,333,D,,bot\n"
        "ALICE,444,A,,ok\n",
        encoding="utf-8",
    )

    rows = bind.read_rows(csv_file)

    assert [(r.username, r.tg_id) for r in rows] == [("alice", 111), ("bob", 222)]


async def test_dry_run_writes_nothing_apply_binds(
    session: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user()
    tg_id = new_tg_id()
    rows = [bind.Row(user.username.upper(), tg_id)]  # логин ищется без учёта регистра

    outcomes = await bind.bind_rows(session, rows, apply=False)
    await session.refresh(user)
    assert [o.action for o in outcomes] == [bind.BIND]
    assert user.tg_id is None

    outcomes = await bind.bind_rows(session, rows, apply=True)
    await session.commit()
    await session.refresh(user)
    assert [o.action for o in outcomes] == [bind.BIND]
    assert user.tg_id == tg_id

    again = await bind.bind_rows(session, rows, apply=True)
    assert [o.action for o in again] == [bind.ALREADY]


async def test_rejects_unknown_login(session: AsyncSession) -> None:
    rows = [bind.Row("no_such_login_xyz", new_tg_id())]
    outcomes = await bind.bind_rows(session, rows, apply=True)
    assert outcomes[0].action == bind.REJECT and "не найден" in outcomes[0].reason


async def test_does_not_overwrite_other_tg_id(session: AsyncSession, make_user: MakeUser) -> None:
    user = await make_user()
    user.tg_id = new_tg_id()
    await session.commit()
    original = user.tg_id

    outcomes = await bind.bind_rows(session, [bind.Row(user.username, new_tg_id())], apply=True)
    await session.refresh(user)

    assert outcomes[0].action == bind.REJECT
    assert user.tg_id == original


async def test_rejects_tg_id_already_on_another_user(
    session: AsyncSession, make_user: MakeUser
) -> None:
    holder = await make_user()
    tg_id = new_tg_id()
    holder.tg_id = tg_id
    other = await make_user()
    await session.commit()

    outcomes = await bind.bind_rows(session, [bind.Row(other.username, tg_id)], apply=True)
    await session.refresh(other)

    assert outcomes[0].action == bind.REJECT and holder.username in outcomes[0].reason
    assert other.tg_id is None


async def test_rejects_tg_id_owned_by_funnel_user(
    session: AsyncSession, make_user: MakeUser
) -> None:
    funnel_user = await make_user()
    tg_id = new_tg_id()
    session.add(
        IntakeApplication(
            tg_id=tg_id, tg_username="x", status=STATUS_CONFIRMED, user_id=funnel_user.id
        )
    )
    other = await make_user()
    await session.commit()

    outcomes = await bind.bind_rows(session, [bind.Row(other.username, tg_id)], apply=True)
    await session.refresh(other)

    assert outcomes[0].action == bind.REJECT and "воронкой" in outcomes[0].reason
    assert other.tg_id is None


async def test_binding_to_own_funnel_application_is_allowed(
    session: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user()
    tg_id = new_tg_id()
    session.add(
        IntakeApplication(tg_id=tg_id, tg_username="x", status=STATUS_CONFIRMED, user_id=user.id)
    )
    await session.commit()

    outcomes = await bind.bind_rows(session, [bind.Row(user.username, tg_id)], apply=True)

    assert outcomes[0].action == bind.BIND


async def test_db_enforces_unique_tg_id(session: AsyncSession, make_user: MakeUser) -> None:
    a = await make_user()
    b = await make_user()
    tg_id = new_tg_id()
    a.tg_id = tg_id
    await session.commit()
    b.tg_id = tg_id
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()
    assert (await session.get(User, a.id)) is not None


def test_report_marks_dry_run() -> None:
    text = bind.format_report([bind.Outcome("u", 1, bind.BIND)], apply=False)
    assert "будет привязан" in text and "Dry-run" in text
