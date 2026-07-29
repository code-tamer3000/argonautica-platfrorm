"""Канон вопросов выпускной анкеты экспедиции.

Здесь — единственный источник правды о форме: по нему фронт рендерит экран,
бэкенд валидирует ответы, админка подписывает их в панели. Ответы хранятся
JSONB'ом (`survey_responses.answers`), ключ — `SurveyQuestion.key`.

Меняешь состав вопросов — поднимай `SURVEY_VERSION`: старые ответы остаются
читаемыми по своей версии, миграция данных не нужна.

Типы вопросов:
- `scale`   — целое из [min, max]; ответ: `{"value": int, "comment": str | None}`
- `choice`  — один из `options`;    ответ: `{"value": str, "comment": str | None}`
- `matrix`  — шкала 1..max по каждой строке; ответ: `{"values": {row_key: int}}`
- `text`    — свободный текст;      ответ: `{"text": str}`
"""
from dataclasses import dataclass, field
from typing import Any

SURVEY_VERSION = 1

# Заголовок экрана — контекст потока, ради которого анкета и собирается.
SURVEY_TITLE = "Экспедиция пройдена"
SURVEY_SUBTITLE = "поток первых · 2–29 июля 2026"
SURVEY_INTRO = (
    "Ты прошёл весь путь: Точка баланса, Воздух, Огонь, Вода, Земля. "
    "Прежде чем платформа откроется дальше — ответь на несколько вопросов. "
    "Это займёт минут десять и правда влияет на то, каким будет следующий поток.\n\n"
    "В конце тебя ждёт подарок — твоя личная книга экспедиции: дневник по дням, "
    "ответы на задания и Генные Замки по стихиям, собранные в один артефакт."
)


@dataclass(frozen=True)
class SurveyOption:
    key: str
    label: str


@dataclass(frozen=True)
class SurveyQuestion:
    key: str
    kind: str  # scale | choice | matrix | text
    title: str
    step: int
    required: bool = True
    hint: str | None = None
    placeholder: str | None = None
    # scale
    min_value: int = 1
    max_value: int = 10
    min_label: str | None = None
    max_label: str | None = None
    # choice / matrix
    options: tuple[SurveyOption, ...] = field(default_factory=tuple)
    # text (и текстовый довесок к scale/choice)
    min_length: int = 0
    max_length: int = 4000
    comment_title: str | None = None
    comment_required: bool = False


SURVEY_STEPS: tuple[str, ...] = (
    "Экспедиция целиком",
    "Форматы пути",
    "Платформа и свободное слово",
)


SURVEY_QUESTIONS: tuple[SurveyQuestion, ...] = (
    # --- Шаг 1: экспедиция целиком -------------------------------------
    SurveyQuestion(
        key="expectations",
        kind="scale",
        step=1,
        title="Насколько экспедиция совпала с тем, за чем ты шёл?",
        min_value=1,
        max_value=10,
        min_label="совсем не то",
        max_label="точно в цель",
    ),
    SurveyQuestion(
        key="nps",
        kind="scale",
        step=1,
        title="Насколько вероятно, что ты порекомендуешь поток близкому человеку?",
        min_value=0,
        max_value=10,
        min_label="точно нет",
        max_label="обязательно",
    ),
    SurveyQuestion(
        key="changed",
        kind="text",
        step=1,
        title="Что реально изменилось в тебе за эти 28 дней?",
        hint="Пиши конкретно: не выводами, а тем, что стало делаться по-другому.",
        placeholder="Раньше я… — теперь…",
        min_length=30,
    ),
    SurveyQuestion(
        key="turning_point",
        kind="text",
        step=1,
        title="Какой момент, задание или день стал поворотным?",
        hint=(
            "Например: «Сжечь ветошь», «Я ничего не знаю», Турнир «Кольцо Воды», "
            "открытие своего Генного Замка."
        ),
        min_length=10,
    ),
    # --- Шаг 2: форматы пути -------------------------------------------
    SurveyQuestion(
        key="formats",
        kind="matrix",
        step=2,
        title="Насколько полезным оказался каждый формат?",
        hint="1 — прошло мимо, 5 — попало в самое сердце.",
        min_value=1,
        max_value=5,
        options=(
            SurveyOption("journal", "Бортовой журнал (дневник по дням)"),
            SurveyOption("common_tasks", "Общие задания"),
            SurveyOption("individual_tasks", "Индивидуальные задания"),
            SurveyOption("pair_task", "Парное задание"),
            SurveyOption("stream", "Турнир «Кольцо Воды»"),
            SurveyOption("gene_keys", "Генные Ключи и Генные Замки"),
            SurveyOption("kb", "Эфиры и встречи по стихиям"),
            SurveyOption("chat", "Чат потока"),
        ),
    ),
    SurveyQuestion(
        key="element",
        kind="choice",
        step=2,
        title="Какая стихия зашла глубже всего?",
        options=(
            SurveyOption("balance", "Точка баланса"),
            SurveyOption("air", "Воздух"),
            SurveyOption("fire", "Огонь"),
            SurveyOption("water", "Вода"),
            SurveyOption("earth", "Земля"),
        ),
        comment_title="Почему именно она?",
        comment_required=True,
    ),
    SurveyQuestion(
        key="too_much_too_little",
        kind="text",
        step=2,
        title="Чего было слишком много, а чего не хватило?",
        placeholder="Слишком много… Не хватило…",
        min_length=10,
    ),
    SurveyQuestion(
        key="openness",
        kind="scale",
        step=2,
        title="Насколько нормально было, что твой дневник видит вся когорта?",
        min_value=1,
        max_value=5,
        min_label="было тяжело",
        max_label="только помогало",
        comment_title="Что здесь стоит учесть? (по желанию)",
    ),
    SurveyQuestion(
        key="rhythm_breaks",
        kind="text",
        step=2,
        title="Где сыпался ритм и что тебя выбивало?",
        required=False,
        placeholder="Можно пропустить, если ритм держался.",
    ),
    # --- Шаг 3: платформа и свободное слово -----------------------------
    SurveyQuestion(
        key="platform",
        kind="scale",
        step=3,
        title="Насколько удобной была сама платформа?",
        min_value=1,
        max_value=5,
        min_label="мешала",
        max_label="не замечал её",
        comment_title="Что чинить в первую очередь?",
    ),
    SurveyQuestion(
        key="testimonial",
        kind="text",
        step=3,
        title="Отзыв, который можно показать другим",
        hint=(
            "Несколько фраз тому, кто сейчас решает, идти ему в экспедицию или нет."
        ),
        min_length=30,
    ),
    SurveyQuestion(
        key="free_word",
        kind="text",
        step=3,
        title="Свободное слово ведущему",
        required=False,
        placeholder="Всё, что не поместилось в вопросы выше.",
    ),
)

# Согласие на публикацию — отдельное поле ответа (`publish_consent`), а не вопрос:
# оно живёт колонкой, чтобы админ фильтровал по нему без разбора JSONB.
PUBLISH_CONSENT_LABEL = (
    "Разрешаю опубликовать мой отзыв с моим именем"
)

QUESTIONS_BY_KEY: dict[str, SurveyQuestion] = {q.key: q for q in SURVEY_QUESTIONS}


def question_form() -> dict[str, Any]:
    """Канон в JSON-виде — фронт рендерит форму по нему, а не по своей копии."""
    return {
        "version": SURVEY_VERSION,
        "title": SURVEY_TITLE,
        "subtitle": SURVEY_SUBTITLE,
        "intro": SURVEY_INTRO,
        "steps": list(SURVEY_STEPS),
        "consent_label": PUBLISH_CONSENT_LABEL,
        "questions": [
            {
                "key": q.key,
                "kind": q.kind,
                "step": q.step,
                "title": q.title,
                "required": q.required,
                "hint": q.hint,
                "placeholder": q.placeholder,
                "min_value": q.min_value,
                "max_value": q.max_value,
                "min_label": q.min_label,
                "max_label": q.max_label,
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
    по шагам по одной.
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

        if q.kind == "matrix":
            values = answer.get("values")
            values = values if isinstance(values, dict) else {}
            picked: dict[str, int] = {}
            for opt in q.options:
                v = values.get(opt.key)
                if isinstance(v, bool) or not isinstance(v, int):
                    continue
                if q.min_value <= v <= q.max_value:
                    picked[opt.key] = v
            if q.required and len(picked) < len(q.options):
                errors.append(f"{q.key}: rate every row")
            if picked:
                clean[q.key] = {"values": picked}
            continue

        if q.kind in {"scale", "choice"}:
            value = answer.get("value")
            ok = False
            if q.kind == "scale":
                ok = (
                    not isinstance(value, bool)
                    and isinstance(value, int)
                    and q.min_value <= value <= q.max_value
                )
            else:
                ok = isinstance(value, str) and value in {o.key for o in q.options}
            if not ok:
                if q.required:
                    errors.append(f"{q.key}: value is required")
                continue
            item: dict[str, Any] = {"value": value}
            comment = _clean_text(answer.get("comment"))
            if q.comment_required and not comment:
                errors.append(f"{q.key}: comment is required")
            if comment:
                if len(comment) > q.max_length:
                    errors.append(f"{q.key}: comment is too long")
                    continue
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
