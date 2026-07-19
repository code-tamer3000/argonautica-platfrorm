"""Тесты задач-потоков (турнирная сетка слияний).

Админ создаёт задание type='stream' со списком участников; сервер строит сетку
(пары → четвёрки → … → корень). Задача идёт лестницей стадий: чётная — все пишут свою
версию текста, нечётная — узлы раунда утверждают общую фразу единогласным
голосованием (либо админ продавливает).

Главное, что здесь проверяется, — видимость (анти-IDOR): чужой текст и чужая фраза не
утекают раньше, чем открываются по правилам, а не-участник не видит поток вовсе.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import RoomMember
from app.models.user import User
from app.services.stream import build_bracket

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _create_stream(
    client: AsyncClient, headers: dict[str, str], user_ids: list[int], **extra: object
) -> dict:
    resp = await client.post(
        "/api/tasks",
        headers=headers,
        json={
            "type": "stream",
            "title": "Как я вижу свою жизнь",
            "participant_ids": user_ids,
            **extra,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _stream(client: AsyncClient, headers: dict[str, str], task_id: int) -> dict:
    resp = await client.get(f"/api/tasks/{task_id}/stream", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _write(
    client: AsyncClient, headers: dict[str, str], task_id: int, body: str
) -> None:
    resp = await client.put(
        f"/api/tasks/{task_id}/stream/texts", headers=headers, json={"body": body}
    )
    assert resp.status_code == 200, resp.text


async def _advance(
    client: AsyncClient, admin_headers: dict[str, str], task_id: int
) -> dict:
    resp = await client.post(
        f"/api/tasks/{task_id}/stream/advance",
        headers=admin_headers,
        json={"deadline_at": None},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _my_node(stream: dict, round_: int) -> dict:
    return next(n for n in stream["nodes"] if n["round"] == round_ and n["is_mine"])


async def _approve(
    client: AsyncClient,
    task_id: int,
    node_id: int,
    proposer: dict[str, str],
    voters: list[dict[str, str]],
    text: str = "Общая фраза",
) -> int:
    """Предложить вариант и собрать за него единогласие. Возвращает option_id."""
    resp = await client.post(
        f"/api/tasks/{task_id}/stream/nodes/{node_id}/options",
        headers=proposer,
        json={"text": text},
    )
    assert resp.status_code == 201, resp.text
    node = next(n for n in resp.json()["nodes"] if n["id"] == node_id)
    option_id = next(o["id"] for o in node["options"] if o["text"] == text)
    for headers in voters:
        vote = await client.put(
            f"/api/tasks/{task_id}/stream/nodes/{node_id}/vote",
            headers=headers,
            json={"option_id": option_id},
        )
        assert vote.status_code == 200, vote.text
    return option_id


# --- построение сетки (чистая функция) ---------------------------------------


def test_build_bracket_16_is_even() -> None:
    """16 участников → 8 пар, 4 четвёрки, 2 восьмёрки, корень; 8 слева, 8 справа."""
    specs = build_bracket(list(range(1, 17)), shuffle=False)
    by_round: dict[int, list] = {}
    for spec in specs:
        by_round.setdefault(spec.round, []).append(spec)

    assert [len(by_round[r]) for r in sorted(by_round)] == [8, 4, 2, 1]
    assert all(len(s.member_ids) == 2 for s in by_round[1])
    assert all(len(s.member_ids) == 4 for s in by_round[2])
    assert all(len(s.member_ids) == 8 for s in by_round[3])
    assert len(by_round[4][0].member_ids) == 16
    assert by_round[4][0].side is None  # корень — в центре канвы

    left = {u for s in specs if s.side == "left" and s.round == 1 for u in s.member_ids}
    right = {u for s in specs if s.side == "right" and s.round == 1 for u in s.member_ids}
    assert len(left) == 8 and len(right) == 8
    assert not (left & right)


def test_build_bracket_odd_count_uses_a_triple() -> None:
    """13 участников → 5 пар + тройка; каждый ровно в одном узле каждого раунда."""
    specs = build_bracket(list(range(1, 14)), shuffle=False)
    round1 = [s for s in specs if s.round == 1]
    assert sorted(len(s.member_ids) for s in round1) == [2, 2, 2, 2, 2, 3]

    depth = max(s.round for s in specs)
    for round_ in range(1, depth + 1):
        seen: list[int] = []
        for spec in (s for s in specs if s.round == round_):
            seen.extend(spec.member_ids)
        assert sorted(seen) == list(range(1, 14))


def test_build_bracket_rejects_too_few() -> None:
    with pytest.raises(ValueError):
        build_bracket([1])


# --- создание -----------------------------------------------------------------


async def test_create_stream_builds_grid_and_assignments(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    headers = await _headers(client, admin)

    task = await _create_stream(client, headers, [u.id for u in users])
    stream = await _stream(client, headers, task["id"])

    assert stream["depth"] == 2
    assert stream["stage"] == 0
    assert stream["stage_kind"] == "text"
    assert stream["total_stages"] == 5
    assert len(stream["nodes"]) == 3  # 2 пары + корень
    assert len(stream["participants"]) == 4

    # Назначение на каждого участника — иначе не работают бейдж и прогресс.
    resp = await client.get(f"/api/tasks/{task['id']}/assignments", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 4


async def test_create_stream_requires_two_participants(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    solo = await make_user()
    headers = await _headers(client, admin)
    resp = await client.post(
        "/api/tasks",
        headers=headers,
        json={"type": "stream", "title": "Один", "participant_ids": [solo.id]},
    )
    assert resp.status_code == 422


# --- анти-IDOR ----------------------------------------------------------------


async def test_outsider_cannot_see_stream(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Не-участник не видит ни задачу, ни сетку."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    outsider = await make_user()
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])

    headers = await _headers(client, outsider)
    assert (await client.get(f"/api/tasks/{task['id']}", headers=headers)).status_code == 403
    assert (
        await client.get(f"/api/tasks/{task['id']}/stream", headers=headers)
    ).status_code == 403


async def test_observer_is_denied(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    observer = await make_user(is_observer=True)
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])

    headers = await _headers(client, observer)
    resp = await client.get(f"/api/tasks/{task['id']}/stream", headers=headers)
    assert resp.status_code == 403


async def test_draft_text_is_private_until_stage_closes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Черновик версии 0 не виден даже напарнику, пока стадия не закрыта."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")

    author = users[0]
    stream = await _stream(client, all_headers[author.id], task_id)
    partner_id = next(
        uid for uid in _my_node(stream, 1)["member_ids"] if uid != author.id
    )

    resp = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author.id}",
        headers=all_headers[partner_id],
    )
    assert resp.status_code == 200
    assert resp.json() == []  # стадия ещё открыта — черновик приватен

    # Автор свой текст видит всегда.
    mine = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author.id}",
        headers=all_headers[author.id],
    )
    assert [t["version"] for t in mine.json()] == [0]


async def test_partner_sees_text_after_stage_closes_but_stranger_does_not(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Версия 0 открывается напарнику по паре — и только ему (плюс админу)."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")
    await _advance(client, admin_headers, task_id)  # стадия 1 — фразы пар

    author = users[0]
    stream = await _stream(client, all_headers[author.id], task_id)
    my_pair = _my_node(stream, 1)["member_ids"]
    partner_id = next(uid for uid in my_pair if uid != author.id)
    stranger_id = next(u.id for u in users if u.id not in my_pair)

    partner_view = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author.id}",
        headers=all_headers[partner_id],
    )
    assert [t["version"] for t in partner_view.json()] == [0]

    stranger_view = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author.id}",
        headers=all_headers[stranger_id],
    )
    assert stranger_view.json() == []  # из соседней пары — ещё нельзя

    admin_view = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author.id}", headers=admin_headers
    )
    assert [t["version"] for t in admin_view.json()] == [0]


async def test_phrase_of_neighbour_pair_hidden_until_stage_closes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Соседняя фраза раскрывается только после закрытия phrase-стадии."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")
    await _advance(client, admin_headers, task_id)

    # Обе пары утверждают свои фразы.
    stream = await _stream(client, admin_headers, task_id)
    pairs = [n for n in stream["nodes"] if n["round"] == 1]
    for index, node in enumerate(pairs):
        members = node["member_ids"]
        await _approve(
            client,
            task_id,
            node["id"],
            all_headers[members[0]],
            [all_headers[uid] for uid in members],
            text=f"фраза пары {index}",
        )

    viewer = users[0]
    view = await _stream(client, all_headers[viewer.id], task_id)
    my_node_id = _my_node(view, 1)["id"]
    for node in (n for n in view["nodes"] if n["round"] == 1):
        if node["id"] == my_node_id:
            assert node["phrase"] is not None  # свою видно сразу
        else:
            assert node["phrase"] is None  # соседнюю — ещё нет

    await _advance(client, admin_headers, task_id)  # стадия 2 — переписывание

    view = await _stream(client, all_headers[viewer.id], task_id)
    assert all(n["phrase"] is not None for n in view["nodes"] if n["round"] == 1)


async def test_cannot_vote_or_propose_in_someone_elses_node(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")
    await _advance(client, admin_headers, task_id)

    intruder = users[0]
    view = await _stream(client, all_headers[intruder.id], task_id)
    other_node = next(
        n for n in view["nodes"] if n["round"] == 1 and not n["is_mine"]
    )

    resp = await client.post(
        f"/api/tasks/{task_id}/stream/nodes/{other_node['id']}/options",
        headers=all_headers[intruder.id],
        json={"text": "влезаю"},
    )
    assert resp.status_code == 403


# --- голосование --------------------------------------------------------------


async def test_unanimity_approves_and_disagreement_does_not(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")
    await _advance(client, admin_headers, task_id)

    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)
    a, b = node["member_ids"]

    # Два варианта, голоса разошлись → фразы нет.
    first = await client.post(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/options",
        headers=all_headers[a],
        json={"text": "вариант А"},
    )
    second = await client.post(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/options",
        headers=all_headers[b],
        json={"text": "вариант Б"},
    )
    options = next(
        n for n in second.json()["nodes"] if n["id"] == node["id"]
    )["options"]
    option_a = next(o["id"] for o in options if o["text"] == "вариант А")
    option_b = next(o["id"] for o in options if o["text"] == "вариант Б")
    assert first.status_code == 201

    await client.put(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/vote",
        headers=all_headers[a],
        json={"option_id": option_a},
    )
    resp = await client.put(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/vote",
        headers=all_headers[b],
        json={"option_id": option_b},
    )
    assert not next(
        n for n in resp.json()["nodes"] if n["id"] == node["id"]
    )["approved"]

    # b переголосовал за А → единогласие, фраза утверждена.
    resp = await client.put(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/vote",
        headers=all_headers[b],
        json={"option_id": option_a},
    )
    approved = next(n for n in resp.json()["nodes"] if n["id"] == node["id"])
    assert approved["approved"]
    assert approved["phrase"] == "вариант А"

    # Передумали — утверждение снимается (единогласия больше нет).
    resp = await client.put(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/vote",
        headers=all_headers[b],
        json={"option_id": option_b},
    )
    assert not next(
        n for n in resp.json()["nodes"] if n["id"] == node["id"]
    )["approved"]


async def test_admin_can_force_phrase(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Продавленная админом фраза утверждает узел и не сбрасывается голосами."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")
    await _advance(client, admin_headers, task_id)

    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)
    resp = await client.patch(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/phrase",
        headers=admin_headers,
        json={"text": "решение админа"},
    )
    assert resp.status_code == 200
    forced = next(n for n in resp.json()["nodes"] if n["id"] == node["id"])
    assert forced["phrase"] == "решение админа"
    assert forced["approved_by_admin"]


async def test_participant_cannot_force_phrase(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)
    headers = await _headers(client, users[0])
    resp = await client.patch(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/phrase",
        headers=headers,
        json={"text": "хочу так"},
    )
    assert resp.status_code == 403


# --- стадии -------------------------------------------------------------------


async def test_cannot_write_text_during_phrase_stage(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")
    await _advance(client, admin_headers, task_id)

    resp = await client.put(
        f"/api/tasks/{task_id}/stream/texts",
        headers=all_headers[users[0].id],
        json={"body": "поздно"},
    )
    assert resp.status_code == 409


async def test_advance_blocked_while_a_node_has_no_phrase(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Из phrase-стадии нельзя уйти, пока хоть один узел без фразы."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")
    await _advance(client, admin_headers, task_id)

    resp = await client.post(
        f"/api/tasks/{task_id}/stream/advance",
        headers=admin_headers,
        json={"deadline_at": None},
    )
    assert resp.status_code == 409


async def test_participant_cannot_advance(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])

    headers = await _headers(client, users[0])
    resp = await client.post(
        f"/api/tasks/{task['id']}/stream/advance",
        headers=headers,
        json={"deadline_at": None},
    )
    assert resp.status_code == 403


async def test_phrase_stage_creates_rooms_with_exactly_the_node_members(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Открытие phrase-стадии создаёт group-комнату на каждый узел раунда."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]

    all_headers = {u.id: await _headers(client, u) for u in users}
    for user in users:
        await _write(client, all_headers[user.id], task_id, f"текст {user.id}")

    before = await _stream(client, admin_headers, task_id)
    assert all(n["room_id"] is None for n in before["nodes"])

    await _advance(client, admin_headers, task_id)

    after = await _stream(client, admin_headers, task_id)
    pairs = [n for n in after["nodes"] if n["round"] == 1]
    assert all(n["room_id"] is not None for n in pairs)
    # Комната корня появится только на своей стадии.
    assert next(n for n in after["nodes"] if n["round"] == 2)["room_id"] is None

    for node in pairs:
        rows = await session.execute(
            RoomMember.__table__.select().where(
                RoomMember.room_id == node["room_id"]
            )
        )
        assert sorted(r.user_id for r in rows) == sorted(node["member_ids"])


async def test_full_run_closes_assignments(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Поток целиком: 4 участника, 2 раунда — финальный текст закрывает назначение."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(4)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    task_id = task["id"]
    all_headers = {u.id: await _headers(client, u) for u in users}

    for version in range(3):  # версии 0, 1 и финальная 2
        for user in users:
            await _write(client, all_headers[user.id], task_id, f"v{version} {user.id}")
        stream = await _advance(client, admin_headers, task_id)
        if stream["finished"]:
            break
        for node in (n for n in stream["nodes"] if n["round"] == stream["stage_round"]):
            members = node["member_ids"]
            await _approve(
                client,
                task_id,
                node["id"],
                all_headers[members[0]],
                [all_headers[uid] for uid in members],
                text=f"фраза {node['id']}",
            )
        await _advance(client, admin_headers, task_id)

    final = await _stream(client, admin_headers, task_id)
    assert final["finished"]

    resp = await client.get(f"/api/tasks/{task_id}/assignments", headers=admin_headers)
    assert {row["status"] for row in resp.json()} == {"accepted"}

    # По завершении финальный текст соседа виден любому участнику потока.
    other = users[1]
    view = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{other.id}",
        headers=all_headers[users[0].id],
    )
    assert final["depth"] in [t["version"] for t in view.json()]
