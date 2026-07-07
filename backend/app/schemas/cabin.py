"""Схемы раздела «Каюта».

Три подраздела с разными полями формы. `data` каждой записи валидируется под свой
`kind` (см. build_data ниже) — на входе мы принимаем строго типизированную форму,
в БД кладём как dict (модель хранит JSONB).
"""
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

CabinKind = Literal["diary", "decatastrophize", "trigger"]

# Строка формы — все текстовые поля необязательны (можно заполнить частично),
# кроме «силы» у дневника/триггера, которую ограничиваем 0..10.
Strength = Annotated[int, Field(ge=0, le=10)]
_TEXT = Field(default="", max_length=4000)


class DiaryData(BaseModel):
    """Дневник эмоций (Таблица №1)."""

    kind: Literal["diary"] = "diary"
    date: str = Field(default="", max_length=64)  # свободная дата, «27.09» и т.п.
    trigger: str = _TEXT
    thoughts: str = _TEXT
    emotion: str = _TEXT
    strength: Strength = 0
    body: str = _TEXT
    reaction: str = _TEXT
    recovery: str = _TEXT  # длительность цикла до восстановления


class TriggerData(BaseModel):
    """Триггеры / построение гипотезы (Таблица №2). Вместо даты — возраст."""

    kind: Literal["trigger"] = "trigger"
    age: str = Field(default="", max_length=64)
    trigger: str = _TEXT
    thoughts: str = _TEXT
    emotion: str = _TEXT
    strength: Strength = 0
    body: str = _TEXT
    reaction: str = _TEXT
    pattern: str = _TEXT  # сформировавшийся паттерн (как я поступаю сейчас)


class DecatastrophizeData(BaseModel):
    """Протокол декатастрофизации: тема + 5 блоков ответов на группы вопросов."""

    kind: Literal["decatastrophize"] = "decatastrophize"
    topic: str = Field(default="", max_length=200)  # напр. «деньги, долги»
    fear: str = _TEXT  # что самое ужасное / чего боюсь / предсказание сознания
    probability: str = _TEXT  # насколько вероятно, случалось ли, реалистичный исход
    worst_best: str = _TEXT  # насколько ужасно / худший / лучший сценарий
    resources: str = _TEXT  # уже происходило? как справился? какие ресурсы есть
    new_idea: str = _TEXT  # новая идея о катастрофе / что хочу услышать в поддержку


CabinData = Annotated[
    DiaryData | TriggerData | DecatastrophizeData,
    Field(discriminator="kind"),
]


class CabinEntryCreate(BaseModel):
    """Тело создания/замены записи: сам `data` (kind внутри него как дискриминатор)."""

    data: CabinData


class CabinEntryOut(BaseModel):
    id: int
    kind: CabinKind
    data: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class AdminCabinEntryOut(CabinEntryOut):
    """Запись в админском просмотре — с автором."""

    user_id: int
    display_name: str
    username: str


class AdminCabinUser(BaseModel):
    """Участник в админском списке Каюты: автор + сколько у него записей всего."""

    user_id: int
    display_name: str
    username: str
    total: int
