from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient

from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def headers(client: AsyncClient, user: User) -> dict[str, str]:
    return auth_headers((await login(client, user.username, "initpass123"))["access_token"])


async def test_structure_lifecycle(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(role="admin")
    writer = await make_user()
    peer = await make_user(intake_id=writer.intake_id)
    outsider = await make_user(intake_starts_on=date.today() - timedelta(days=200))
    admin_h = await headers(client, admin)
    writer_h = await headers(client, writer)
    peer_h = await headers(client, peer)
    outsider_h = await headers(client, outsider)

    questions = [{"id": "strength", "kind": "scale", "label": "Сила"},
                 {"id": "event", "kind": "text", "label": "Событие"}]
    create = {"title": "Наблюдения", "type": "structure", "intake_id": writer.intake_id,
              "questions": questions}
    assert (await client.post("/api/tasks", json=create, headers=admin_h)).status_code == 422
    future = datetime.now(UTC) + timedelta(days=1)
    created = await client.post("/api/tasks", json={**create, "deadline_at": future.isoformat()},
                                headers=admin_h)
    assert created.status_code == 201, created.text
    tid = created.json()["id"]
    task = f"/api/tasks/{tid}"
    assert (await client.get(task, headers=outsider_h)).status_code == 403
    for invalid in [{"strength": 11, "event": "a"}, {"strength": True, "event": "a"},
                    {"strength": 1}, {"strength": 1, "event": "   "}]:
        assert (await client.post(f"{task}/entries", json={"answers": invalid},
                                  headers=writer_h)).status_code == 422
    for text in ["Первая", "Вторая"]:
        result = await client.post(f"{task}/entries", headers=writer_h,
                                   json={"answers": {"event": text, "strength": 5}})
        assert result.status_code == 201, result.text
    assert (await client.get(task, headers=writer_h)).json()["my_status"] == "in_progress"
    profile = (await client.get(f"/api/argonauts/{writer.id}", headers=peer_h)).json()
    row = next(t for t in profile["tasks"] if t["task_id"] == tid)
    assert [e["answers"]["event"] for e in row["entries"]] == ["Первая", "Вторая"]
    assert row["questions"] == questions
    async def queued() -> list:
        response = await client.get("/api/admin/review-queue", headers=admin_h)
        assert response.status_code == 200, response.text
        return [r for r in response.json() if r["task_id"] == tid]

    assert await queued() == []
    assert (await client.post(f"{task}/submissions", json={"body": "обычная"},
                              headers=writer_h)).status_code == 400
    assert (await client.patch(task, headers=admin_h,
                               json={"questions": questions[:1]})).status_code == 409
    roster = (await client.get(f"{task}/assignments", headers=admin_h)).json()
    assignment = next(r for r in roster if r["user_id"] == writer.id)
    assert assignment["submission_count"] == 2
    assert next(r for r in roster if r["user_id"] == peer.id)["submission_count"] == 0
    review = f"/api/tasks/assignments/{assignment['assignment_id']}/review"
    assert (await client.post(review, json={"action": "accept"}, headers=admin_h)).status_code == 409

    past = datetime.now(UTC) - timedelta(seconds=1)
    assert (await client.patch(task, json={"deadline_at": past.isoformat()},
                               headers=admin_h)).status_code == 200
    assert (await client.get(task, headers=peer_h)).json()["my_status"] == "missed"
    assert [r["user_id"] for r in await queued()] == [writer.id]
    assert (await client.post(f"{task}/entries", headers=writer_h,
                              json={"answers": {"event": "поздно", "strength": 1}})).status_code == 409
    assert (await client.post(review, json={"action": "return"}, headers=admin_h)).status_code == 409
    assert (await client.post(review, json={"action": "accept"}, headers=admin_h)).status_code == 200
    assert await queued() == []
