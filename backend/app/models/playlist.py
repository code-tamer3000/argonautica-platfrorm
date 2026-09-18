"""Плейлист — вложение из нескольких аудиотреков, играющих подряд одним объектом.

Принадлежит своему носителю (сообщение / задача / материал КБ) целиком: своего ACL
нет, права читаются через `playlist_id` на носителе (см. `services/media.py::
assert_media_access`, ветку "Плейлист"). Не редактируется после отправки (см.
docs/FILES.md «Плейлист») — поэтому нет отдельного update-эндпоинта/сервиса.
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Playlist(Base):
    """Название + обложка. Состав — `PlaylistTrack`, порядок = порядок прикрепления."""

    __tablename__ = "playlists"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    # Обложка: встроенная картинка первого трека (загружена как обычный media_asset
    # kind='image' на клиенте до создания плейлиста) либо кастомная от автора. NULL —
    # ни того ни другого, фронт рисует заглушку дизайн-системы.
    cover_media_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("media_assets.id")
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PlaylistTrack(Base):
    """Один трек плейлиста. `media_asset_id` — существующий kind='audio' ассет
    (обычный upload-flow, docs/FILES.md). Название/исполнитель/длительность —
    снимок на момент прикрепления (из ID3-тегов файла либо введены автором вручную,
    либо имя файла как фолбэк) — не общая фонотека, поэтому не смотрят в
    media_assets напрямую.
    """

    __tablename__ = "playlist_tracks"
    __table_args__ = (
        UniqueConstraint("playlist_id", "position", name="uq_playlist_tracks_position"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    playlist_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False
    )
    media_asset_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("media_assets.id"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-based, порядок игры
    title: Mapped[str] = mapped_column(Text, nullable=False)
    artist: Mapped[str | None] = mapped_column(Text)
    duration: Mapped[int | None] = mapped_column(Integer)  # секунды; фолбэк — media_assets.duration
