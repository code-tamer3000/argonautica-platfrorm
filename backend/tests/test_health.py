"""Smoke-тест приложения.

`TestClient` как контекст-менеджер прогоняет lifespan (пинг Redis на старте), так
что тест заодно проверяет: приложение импортируется с заданным окружением,
проводка lifespan/Redis работает, и роут отвечает.
"""
from fastapi.testclient import TestClient

from app.main import app


def test_health_ok() -> None:
    with TestClient(app) as client:
        resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
