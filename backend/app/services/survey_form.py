"""Канон вопросов выпускной анкеты экспедиции.

Здесь — единственный источник правды о форме: по нему фронт рендерит экран,
бэкенд валидирует ответы, админка подписывает их в панели. Ответы хранятся
JSONB'ом (`survey_responses.answers`), ключ — `SurveyQuestion.key`.

Меняешь состав вопросов — поднимай `SURVEY_VERSION`: старые ответы остаются
читаемыми по своей версии, миграция данных не нужна.

Анкета одностраничная, шкал и оценок в ней нет — только рассказ своими словами,
поэтому и типов вопросов всего два.

Типы вопросов:
- `text`  — свободный текст; ответ: `{"text": str}`
- `multi` — несколько вариантов из `options` + поле для отписки;
            ответ: `{"choices": [option_key], "comment": str | None}`
"""
from dataclasses import dataclass, field
from typing import Any

SURVEY_VERSION = 1

# Заголовок экрана — контекст потока, ради которого анкета и собирается.
SURVEY_TITLE = "Экспедиция пройдена"
SURVEY_SUBTITLE = "поток первых · 2–29 июля 2026"
SURVEY_INTRO = (
    "Ты прошёл весь путь. "
    "Прежде чем платформа откроется дальше — ответь на несколько вопросов. "
    "Ты первый. Твои ответы повлияют на будущее Аргонавтики\n\n"
    "В конце тебя ждёт подарок — твоя личная книга артефакт из Экспедиции"
)


@dataclass(frozen=True)
class SurveyOption:
    key: str
    label: str


@dataclass(frozen=True)
class SurveyQuestion:
    key: str
    kind: str  # text | multi
    title: str
    required: bool = True
    hint: str | None = None
    placeholder: str | None = None
    # multi
    options: tuple[SurveyOption, ...] = field(default_factory=tuple)
    # text (и поле для отписки у multi)
    min_length: int = 0
    max_length: int = 4000
    comment_title: str | None = None
    comment_required: bool = False


SURVEY_QUESTIONS: tuple[SurveyQuestion, ...] = (
    SurveyQuestion(
        key="changed",
        kind="text",
        title="Что реально изменилось в тебе за эти 28 дней?",
        hint="Срыв старых шаблонов, новые ощущения и другие изменения",
        placeholder="Раньше я… — теперь…",
        min_length=30,
    ),
    SurveyQuestion(
        key="turning_point",
        kind="text",
        title="Какой момент, задание или день стал поворотным и почему?",
        hint=(
            "Например: «Сжечь ветошь», «Я ничего не знаю», "
            "открытие своего Генного Замка."
        ),
        min_length=10,
    ),
    SurveyQuestion(
        key="journal_formats",
        kind="text",
        title=(
            "В экспедиции было несколько форматов ведения дневника. "
            "Что понравилось, что возьмёшь с собой? "
            "Какой свой формат ты бы хотел предложить?"
        ),
        hint=(
            "Форматы были такие: «Фокус на день», «Заметки», «Фильм дня», "
            "описание дня через стихию, «Чем я занимаюсь?»."
        ),
        min_length=10,
    ),
    SurveyQuestion(
        key="element",
        kind="multi",
        title="Какие стихии зашли глубже всего?",
        hint="Можно отметить несколько.",
        options=(
            SurveyOption("balance", "Точка баланса"),
            SurveyOption("air", "Воздух"),
            SurveyOption("fire", "Огонь"),
            SurveyOption("water", "Вода"),
            SurveyOption("earth", "Земля"),
        ),
        comment_title="Почему именно они?",
        comment_required=True,
    ),
    SurveyQuestion(
        key="too_much_too_little",
        kind="text",
        title="Чего было слишком много, а чего не хватило?",
        placeholder="Слишком много… Не хватило…",
        min_length=10,
    ),
    SurveyQuestion(
        key="openness",
        kind="text",
        title=(
            "Насколько нормально было, что твой дневник видит вся когорта? "
            "Что здесь стоит учесть?"
        ),
        required=False,
    ),
    SurveyQuestion(
        key="rhythm_breaks",
        kind="text",
        title=(
            "Где сыпался ритм и что тебя выбивало? "
            "Про турнир Кольцо Воды - можно не писать и так понятно"
        ),
        required=False,
        placeholder="",
    ),
    SurveyQuestion(
        key="platform",
        kind="text",
        title="Насколько удобной была сама платформа и что чинить в первую очередь?",
        min_length=10,
    ),
    SurveyQuestion(
        key="testimonial",
        kind="text",
        title="Отзыв, который можно показать другим",
        hint=(
            "Чтобы ты хотел сказать людям, которые только решают встать на путь Аргонавта"
        ),
        min_length=30,
    ),
)

# Согласие на публикацию — отдельное поле ответа (`publish_consent`), а не вопрос:
# оно живёт колонкой, чтобы админ фильтровал по нему без разбора JSONB.
PUBLISH_CONSENT_LABEL = (
    "Разрешаю, чтобы Мир увидел мой отзыв с моим именем"
)

QUESTIONS_BY_KEY: dict[str, SurveyQuestion] = {q.key: q for q in SURVEY_QUESTIONS}


def question_form() -> dict[str, Any]:
    """Канон в JSON-виде — фронт рендерит форму по нему, а не по своей копии."""
    return {
        "version": SURVEY_VERSION,
        "title": SURVEY_TITLE,
        "subtitle": SURVEY_SUBTITLE,
        "intro": SURVEY_INTRO,
        "consent_label": PUBLISH_CONSENT_LABEL,
        "questions": [
            {
                "key": q.key,
                "kind": q.kind,
                "title": q.title,
                "required": q.required,
                "hint": q.hint,
                "placeholder": q.placeholder,
                "options": [{"key": o.key, "label": o.label} for o in q.options],
                "min_length": q.min_length,
                "max_length": q.max_length,
                "comment_title": q.comment_title,
                "comment_required": q.comment_required,
            }
            for q in SURVEY_QUESTIONS
        ],
    }


def _clean_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def validate_answers(raw: dict[str, Any]) -> dict[str, Any]:
    """Проверяет ответы против канона и возвращает нормализованный словарь.

    Лишние ключи — ошибка (клиент шлёт не ту форму), пустые необязательные —
    просто выкидываются. Ошибки собираются все сразу: незачем гонять человека
    по форме по одной.
    """
    unknown = set(raw) - set(QUESTIONS_BY_KEY)
    if unknown:
        raise ValueError(f"Unknown answer keys: {', '.join(sorted(unknown))}")

    errors: list[str] = []
    clean: dict[str, Any] = {}

    for q in SURVEY_QUESTIONS:
        answer = raw.get(q.key)
        if answer is not None and not isinstance(answer, dict):
            errors.append(f"{q.key}: answer must be an object")
            continue
        answer = answer or {}

        if q.kind == "multi":
            raw_choices = answer.get("choices")
            picked = set(raw_choices) if isinstance(raw_choices, list) else set()
            # Порядок — как в каноне, а не как прислал клиент: так ответы разных
            # людей читаются одинаково. Заодно отсекаются чужие ключи.
            choices = [o.key for o in q.options if o.key in picked]
            if not choices:
                if q.required:
                    errors.append(f"{q.key}: pick at least one option")
                continue
            item: dict[str, Any] = {"choices": choices}
            comment = _clean_text(answer.get("comment"))
            if q.comment_required and not comment:
                errors.append(f"{q.key}: comment is required")
            elif len(comment) > q.max_length:
                errors.append(f"{q.key}: comment is too long")
            elif comment:
                item["comment"] = comment
            clean[q.key] = item
            continue

        # text
        text = _clean_text(answer.get("text"))
        if not text:
            if q.required:
                errors.append(f"{q.key}: answer is required")
            continue
        if len(text) < q.min_length:
            errors.append(f"{q.key}: at least {q.min_length} characters")
            continue
        if len(text) > q.max_length:
            errors.append(f"{q.key}: at most {q.max_length} characters")
            continue
        clean[q.key] = {"text": text}

    if errors:
        raise ValueError("; ".join(errors))
    return clean
