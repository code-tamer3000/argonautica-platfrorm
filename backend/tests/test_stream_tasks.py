"""Тесты задач-потоков (турнирная сетка слияний).

Админ создаёт задание type='stream' со списком участников; сервер строит сетку
(пары → четвёрки → … → корень). Глобальных стадий НЕТ: подгруппа, закончившая работу,
идёт дальше сразу и ждёт только соседей — всё состояние выводится из сданных текстов и
утверждённых фраз.

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
) -> dict:
    resp = await client.put(
        f"/api/tasks/{task_id}/stream/texts", headers=headers, json={"body": body}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


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


async def _setup(
    client: AsyncClient, make_user: MakeUser, count: int = 4
) -> tuple[dict[str, str], list[User], dict[int, dict[str, str]], int]:
    """Админ + участники + созданный поток → (admin_headers, users, headers, task_id)."""
    admin = await make_user(role="admin")
    users = [await make_user() for _ in range(count)]
    admin_headers = await _headers(client, admin)
    task = await _create_stream(client, admin_headers, [u.id for u in users])
    headers = {u.id: await _headers(client, u) for u in users}
    return admin_headers, users, headers, task["id"]


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
    admin_headers, _users, _hdrs, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)

    assert stream["depth"] == 2
    assert stream["finished"] is False
    assert len(stream["nodes"]) == 3  # 2 пары + корень
    assert len(stream["participants"]) == 4
    assert all(p["version"] == 0 for p in stream["participants"])

    # Назначение на каждого участника — иначе не работают бейдж и прогресс.
    resp = await client.get(f"/api/tasks/{task_id}/assignments", headers=admin_headers)
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


# --- локальное продвижение (главное отличие от глобальных стадий) -------------


async def test_pair_proceeds_without_waiting_for_the_rest(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Пара, где оба сдали, выбирает фразу СРАЗУ — соседи ещё даже не начинали."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)

    stream = await _stream(client, admin_headers, task_id)
    first, second = [n for n in stream["nodes"] if n["round"] == 1]

    for uid in first["member_ids"]:
        await _write(client, headers[uid], task_id, f"текст {uid}")

    view = await _stream(client, headers[first["member_ids"][0]], task_id)
    assert next(n for n in view["nodes"] if n["id"] == first["id"])["ready"] is True
    assert view["my_active_node_id"] == first["id"]

    # И действительно голосует, хотя вторая пара не написала ни строчки.
    await _approve(
        client,
        task_id,
        first["id"],
        headers[first["member_ids"][0]],
        [headers[uid] for uid in first["member_ids"]],
        text="фраза первой пары",
    )

    view = await _stream(client, admin_headers, task_id)
    assert next(n for n in view["nodes"] if n["id"] == first["id"])["approved"]
    assert next(n for n in view["nodes"] if n["id"] == second["id"])["ready"] is False


async def test_next_version_waits_only_for_the_neighbour_subgroup(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Переписать текст можно, лишь когда готовы обе пары четвёрки — но не позже."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)

    stream = await _stream(client, admin_headers, task_id)
    first, second = [n for n in stream["nodes"] if n["round"] == 1]
    me = first["member_ids"][0]

    for uid in first["member_ids"] + second["member_ids"]:
        await _write(client, headers[uid], task_id, f"текст {uid}")
    await _approve(
        client,
        task_id,
        first["id"],
        headers[first["member_ids"][0]],
        [headers[uid] for uid in first["member_ids"]],
        text="фраза 1",
    )

    # Своя пара договорилась, соседняя — нет: версия ещё 0, ждём именно соседей.
    view = await _stream(client, headers[me], task_id)
    assert view["my_version"] == 0
    assert view["my_waiting_on"] == [second["id"]]

    await _approve(
        client,
        task_id,
        second["id"],
        headers[second["member_ids"][0]],
        [headers[uid] for uid in second["member_ids"]],
        text="фраза 2",
    )

    view = await _stream(client, headers[me], task_id)
    assert view["my_version"] == 1
    assert view["my_waiting_on"] == []
    # И теперь видна фраза соседней пары — на её основе и переписываем.
    assert next(n for n in view["nodes"] if n["id"] == second["id"])["phrase"] == "фраза 2"


async def test_cannot_vote_before_the_whole_subgroup_submitted(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Один сдал, напарник нет — узел не готов, голосовать рано (409)."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)
    a, _b = node["member_ids"]

    await _write(client, headers[a], task_id, "только я")
    resp = await client.post(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/options",
        headers=headers[a],
        json={"text": "рано"},
    )
    assert resp.status_code == 409


# --- анти-IDOR ----------------------------------------------------------------


async def test_outsider_cannot_see_stream(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Не-участник не видит ни задачу, ни сетку."""
    _admin_headers, _users, _hdrs, task_id = await _setup(client, make_user)
    outsider = await make_user()

    headers = await _headers(client, outsider)
    assert (await client.get(f"/api/tasks/{task_id}", headers=headers)).status_code == 403
    assert (
        await client.get(f"/api/tasks/{task_id}/stream", headers=headers)
    ).status_code == 403


async def test_observer_is_denied(client: AsyncClient, make_user: MakeUser) -> None:
    _admin_headers, _users, _hdrs, task_id = await _setup(client, make_user)
    observer = await make_user(is_observer=True)

    headers = await _headers(client, observer)
    resp = await client.get(f"/api/tasks/{task_id}/stream", headers=headers)
    assert resp.status_code == 403


async def test_draft_is_private_until_the_whole_pair_submitted(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Черновик не виден даже напарнику, пока напарник сам не сдал."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)
    author, partner = node["member_ids"]

    await _write(client, headers[author], task_id, "мой текст")

    resp = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author}", headers=headers[partner]
    )
    assert resp.status_code == 200
    assert resp.json() == []  # напарник ещё не сдал — подсмотреть нельзя

    mine = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author}", headers=headers[author]
    )
    assert [t["version"] for t in mine.json()] == [0]


async def test_partner_sees_text_once_both_submitted_but_stranger_does_not(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Оба сдали → текст открылся напарнику. Соседней паре — нет."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    first, second = [n for n in stream["nodes"] if n["round"] == 1]
    author, partner = first["member_ids"]
    stranger = second["member_ids"][0]

    for uid in first["member_ids"]:
        await _write(client, headers[uid], task_id, f"текст {uid}")

    partner_view = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author}", headers=headers[partner]
    )
    assert [t["version"] for t in partner_view.json()] == [0]

    stranger_view = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author}", headers=headers[stranger]
    )
    assert stranger_view.json() == []

    admin_view = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{author}", headers=admin_headers
    )
    assert [t["version"] for t in admin_view.json()] == [0]


async def test_neighbour_phrase_hidden_until_approved(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Фраза соседней пары не видна, пока та её не утвердила."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    first, second = [n for n in stream["nodes"] if n["round"] == 1]
    viewer = first["member_ids"][0]

    for uid in first["member_ids"] + second["member_ids"]:
        await _write(client, headers[uid], task_id, f"текст {uid}")
    await _approve(
        client,
        task_id,
        first["id"],
        headers[first["member_ids"][0]],
        [headers[uid] for uid in first["member_ids"]],
        text="моя фраза",
    )

    view = await _stream(client, headers[viewer], task_id)
    assert next(n for n in view["nodes"] if n["id"] == first["id"])["phrase"] == "моя фраза"
    assert next(n for n in view["nodes"] if n["id"] == second["id"])["phrase"] is None

    await _approve(
        client,
        task_id,
        second["id"],
        headers[second["member_ids"][0]],
        [headers[uid] for uid in second["member_ids"]],
        text="соседняя фраза",
    )

    view = await _stream(client, headers[viewer], task_id)
    assert (
        next(n for n in view["nodes"] if n["id"] == second["id"])["phrase"]
        == "соседняя фраза"
    )


async def test_cannot_vote_or_propose_in_someone_elses_node(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    first, second = [n for n in stream["nodes"] if n["round"] == 1]
    intruder = first["member_ids"][0]

    for uid in second["member_ids"]:
        await _write(client, headers[uid], task_id, f"текст {uid}")

    resp = await client.post(
        f"/api/tasks/{task_id}/stream/nodes/{second['id']}/options",
        headers=headers[intruder],
        json={"text": "влезаю"},
    )
    assert resp.status_code == 403


# --- голосование --------------------------------------------------------------


async def test_unanimity_approves_and_disagreement_does_not(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)
    a, b = node["member_ids"]
    for uid in node["member_ids"]:
        await _write(client, headers[uid], task_id, f"текст {uid}")

    await client.post(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/options",
        headers=headers[a],
        json={"text": "вариант А"},
    )
    second = await client.post(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/options",
        headers=headers[b],
        json={"text": "вариант Б"},
    )
    options = next(n for n in second.json()["nodes"] if n["id"] == node["id"])["options"]
    option_a = next(o["id"] for o in options if o["text"] == "вариант А")
    option_b = next(o["id"] for o in options if o["text"] == "вариант Б")

    await client.put(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/vote",
        headers=headers[a],
        json={"option_id": option_a},
    )
    resp = await client.put(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/vote",
        headers=headers[b],
        json={"option_id": option_b},
    )
    assert not next(n for n in resp.json()["nodes"] if n["id"] == node["id"])["approved"]

    # b переголосовал за А → единогласие, фраза утверждена.
    resp = await client.put(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/vote",
        headers=headers[b],
        json={"option_id": option_a},
    )
    approved = next(n for n in resp.json()["nodes"] if n["id"] == node["id"])
    assert approved["approved"]
    assert approved["phrase"] == "вариант А"


async def test_approved_phrase_is_final(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Утверждённую фразу нельзя переиграть голосом: на неё уже опираются соседи."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)
    a, b = node["member_ids"]
    for uid in node["member_ids"]:
        await _write(client, headers[uid], task_id, f"текст {uid}")

    option_id = await _approve(
        client, task_id, node["id"], headers[a], [headers[a], headers[b]], text="итог"
    )
    resp = await client.put(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/vote",
        headers=headers[b],
        json={"option_id": option_id},
    )
    assert resp.status_code == 409


async def test_admin_can_force_phrase(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Продавленная админом фраза разблокирует зависшую подгруппу."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)
    for uid in node["member_ids"]:
        await _write(client, headers[uid], task_id, f"текст {uid}")

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
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    node = next(n for n in stream["nodes"] if n["round"] == 1)

    resp = await client.patch(
        f"/api/tasks/{task_id}/stream/nodes/{node['id']}/phrase",
        headers=headers[node["member_ids"][0]],
        json={"text": "хочу так"},
    )
    assert resp.status_code == 403


# --- комнаты и полный прогон --------------------------------------------------


async def test_room_appears_when_the_subgroup_is_complete(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Комната подгруппы заводится в момент её готовности, а не по общему флипу."""
    admin_headers, _users, headers, task_id = await _setup(client, make_user)
    stream = await _stream(client, admin_headers, task_id)
    first, second = [n for n in stream["nodes"] if n["round"] == 1]

    a, b = first["member_ids"]
    await _write(client, headers[a], task_id, "раз")
    view = await _stream(client, admin_headers, task_id)
    assert next(n for n in view["nodes"] if n["id"] == first["id"])["room_id"] is None

    await _write(client, headers[b], task_id, "два")
    view = await _stream(client, admin_headers, task_id)
    room_id = next(n for n in view["nodes"] if n["id"] == first["id"])["room_id"]
    assert room_id is not None
    # У соседней пары комнаты ещё нет — она не готова.
    assert next(n for n in view["nodes"] if n["id"] == second["id"])["room_id"] is None

    rows = await session.execute(
        RoomMember.__table__.select().where(RoomMember.room_id == room_id)
    )
    assert sorted(r.user_id for r in rows) == sorted(first["member_ids"])


async def test_full_run_closes_assignments(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Поток целиком: 4 участника, 2 раунда — финальный текст закрывает назначение."""
    admin_headers, users, headers, task_id = await _setup(client, make_user)

    for _ in range(10):  # с запасом; выходим по finished
        stream = await _stream(client, admin_headers, task_id)
        if stream["finished"]:
            break
        for participant in stream["participants"]:
            if not participant["submitted_current"]:
                await _write(
                    client,
                    headers[participant["user_id"]],
                    task_id,
                    f"v{participant['version']} от {participant['user_id']}",
                )
        stream = await _stream(client, admin_headers, task_id)
        for node in stream["nodes"]:
            if node["ready"] and not node["approved"]:
                members = node["member_ids"]
                await _approve(
                    client,
                    task_id,
                    node["id"],
                    headers[members[0]],
                    [headers[uid] for uid in members],
                    text=f"фраза {node['id']}",
                )

    final = await _stream(client, admin_headers, task_id)
    assert final["finished"]
    assert all(n["approved"] for n in final["nodes"])

    resp = await client.get(f"/api/tasks/{task_id}/assignments", headers=admin_headers)
    assert {row["status"] for row in resp.json()} == {"accepted"}

    # По завершении финальный текст соседа виден любому участнику потока.
    view = await client.get(
        f"/api/tasks/{task_id}/stream/texts/{users[1].id}",
        headers=headers[users[0].id],
    )
    assert final["depth"] in [t["version"] for t in view.json()]
