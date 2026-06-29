"""Настройки приложения из окружения (pydantic-settings).

Единственный источник конфигурации. Значения берутся из переменных окружения
(см. `.env.example`). Секреты — только в `.env` (в .gitignore), никогда в git.
"""
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Ищем .env и в корне репо, и в backend/ (порядок: позже -> приоритетнее).
        # Реальные переменные окружения всё равно перекрывают файл.
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Postgres ---
    # asyncpg-драйвер: postgresql+asyncpg://user:pass@host:5432/db
    database_url: str

    # --- Redis ---
    redis_url: str

    # --- MinIO (S3-совместимо) ---
    # minio_endpoint — внутренний адрес (docker-сеть), для server-side вызовов.
    minio_endpoint: str
    # minio_public_endpoint — адрес для браузера (presigned URL); пусто -> = minio_endpoint.
    minio_public_endpoint: str = ""
    minio_root_user: str
    minio_root_password: str
    minio_bucket_media: str = "chat-media"
    minio_bucket_kb: str = "kb-media"

    # --- JWT ---
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_minutes: int = 15
    jwt_refresh_ttl_days: int = 30

    @model_validator(mode="after")
    def _default_public_endpoint(self) -> "Settings":
        # Браузеру нужен публичный адрес MinIO (напр. localhost:9000), а не
        # внутреннее docker-имя (minio:9000). Если не задан — берём внутренний.
        if not self.minio_public_endpoint:
            self.minio_public_endpoint = self.minio_endpoint
        return self


@lru_cache
def get_settings() -> Settings:
    # Значения обязательных полей приходят из окружения / .env.
    return Settings()


settings = get_settings()
