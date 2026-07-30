"""Экспедиция пройдена (`users.graduated_at`) — единые правила «конца пути».

Флаг ставится один раз, в момент отправки выпускной анкеты (app/api/survey.py), и
не снимается. Он НЕ закрывает платформу (в отличие от `survey_required`, который
перекрывает её целиком до отправки анкеты) — человек остаётся внутри, но только
как читатель:

- Динамика исчезает у него самого (роутер `/api/dynamics` → 403); у админа в
  панели она остаётся, замороженная на дне выпуска, с отметкой о выпуске;
- в Задачах видны только сданные задачи, новых сдач и комментариев нет;
- в Рубке (личные чаты, дневник, каналы) вся история на месте, но писать,
  править, удалять, закреплять и «печатать» нельзя.
"""
from fastapi import HTTPException, status

from app.models.user import User

# Текст, который видит выпускник вместо поля ввода. Фронт показывает его сам
# (features/chat/GraduatedNotice.tsx), бэкенд — в 403 на пишущих путях.
GRADUATED_MESSAGE = "Аргонавт, ты прошёл Экспедицию"


def is_graduated(user: User) -> bool:
    return user.graduated_at is not None


def assert_not_graduated(user: User) -> None:
    """Пишущее действие выпускника → 403. Читающие пути не трогаем."""
    if is_graduated(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, GRADUATED_MESSAGE)
