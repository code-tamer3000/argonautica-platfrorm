import type { CabinData, CabinKind } from '../../lib/types'

/** Описание одного поля формы подраздела. */
export interface FieldSpec {
  name: string
  label: string
  hint?: string
  /** short — однострочный input; long — textarea; strength — ползунок 0..10. */
  kind: 'short' | 'long' | 'strength'
  /** Подставлять сегодняшнюю дату в новую запись (для поля «Дата»). */
  today?: boolean
}

/** Сегодняшняя дата в формате ДД.ММ.ГГГГ (как в таблицах автора). */
export function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** Заголовки, подзаголовки и наборы полей для каждого подраздела «Каюты».
 *
 * `titleField` идёт в заголовок карточки. `groupBy` (если задан) — поле, по
 * которому записи группируются в раскрывающиеся секции (у дневника — дата: за
 * одну дату может быть несколько записей, поэтому дата не заголовок, а группа). */
export const CABIN_SECTIONS: Record<
  CabinKind,
  { title: string; subtitle: string; fields: FieldSpec[]; titleField: string; groupBy?: string }
> = {
  diary: {
    title: 'Дневник самонаблюдения',
    subtitle:
      'Фиксируйте триггерное событие и раскладывайте реакцию на составляющие: ' +
      'мысли, эмоции, телесные ощущения. Пишите коротко и по делу.',
    titleField: 'trigger',
    groupBy: 'date',
    fields: [
      { name: 'date', label: 'Дата', kind: 'short', today: true },
      { name: 'trigger', label: 'Триггерное событие', hint: 'что произошло?', kind: 'long' },
      { name: 'thoughts', label: 'Автоматические мысли', hint: 'что я думаю?', kind: 'long' },
      { name: 'emotion', label: 'Эмоция', hint: 'что я чувствую? (страх, гнев…)', kind: 'long' },
      { name: 'strength', label: 'Сила ощущения', kind: 'strength' },
      { name: 'body', label: 'Ощущение в теле', hint: 'как реагирует тело? (дрожь в руках, сжатие в груди и т.д.)', kind: 'long' },
      {
        name: 'reaction',
        label: 'Реакция',
        hint: 'как я реагирую в данной ситуации? (то, что не свойственно в обычной жизни)',
        kind: 'long',
      },
      {
        name: 'recovery',
        label: 'Длительность цикла до восстановления',
        hint: 'несколько минут, полчаса, час, день…',
        kind: 'short',
      },
    ],
  },
  trigger: {
    title: 'Травматика прошлого',
    subtitle:
      'Построение гипотезы: корневые события прошлого, которые питают травму.',
    titleField: 'age',
    fields: [
      { name: 'age', label: 'Возраст', kind: 'short', hint: 'в каком возрасте произошло событие?' },
      { name: 'trigger', label: 'Триггерное событие', hint: 'что тогда произошло?', kind: 'long' },
      { name: 'thoughts', label: 'Автоматические мысли', hint: 'что я думал о ситуации в тот момент?', kind: 'long' },
      { name: 'emotion', label: 'Эмоция', hint: 'что я почувствовал в тот момент?', kind: 'long' },
      { name: 'strength', label: 'Сила ощущения', kind: 'strength' },
      {
        name: 'body',
        label: 'Ощущение в теле',
        hint: 'как отреагировало тело в тот момент? (дрожь в руках, сжатие в груди и т.д.)',
        kind: 'long',
      },
      { name: 'reaction', label: 'Реакция', hint: 'как я повёл себя в той ситуации?', kind: 'long' },
      {
        name: 'pattern',
        label: 'Сформировавшийся паттерн',
        hint: 'какой шаблон поведения закрепился после той ситуации?',
        kind: 'long',
      },
    ],
  },
  decatastrophize: {
    title: 'Протокол декатастрофизации',
    subtitle:
      'Разберите страх по шагам: что самое ужасное может произойти, насколько это ' +
      'вероятно, что реально помогает — и сформулируйте новую, поддерживающую идею.',
    titleField: 'topic',
    fields: [
      { name: 'topic', label: 'Тема', kind: 'short', hint: 'например: деньги, долги' },
      {
        name: 'fear',
        label: 'Что самое ужасное может произойти?',
        hint: 'Чего именно боитесь? Что предсказывает сознание? (0–100%)',
        kind: 'long',
      },
      {
        name: 'probability',
        label: 'Насколько это вероятно?',
        hint: 'Случалось ли такое? Как часто? Каков реалистичный исход?',
        kind: 'long',
      },
      {
        name: 'worst_best',
        label: 'Худший и лучший сценарий',
        hint: 'Насколько это будет ужасно? Что бы я сказал другу в такой ситуации?',
        kind: 'long',
      },
      {
        name: 'resources',
        label: 'Ресурсы',
        hint: 'Подобное уже происходило? Как справились? Что и кто поможет?',
        kind: 'long',
      },
      {
        name: 'new_idea',
        label: 'Новая идея',
        hint: 'Сформулируйте новую идею о катастрофе. Что хотели бы услышать в поддержку?',
        kind: 'long',
      },
    ],
  },
}

/** Пустая заготовка data для нового элемента подраздела.
 * Поля с `today` (дата) сразу заполняются сегодняшней датой. */
export function emptyData(kind: CabinKind): CabinData {
  const base = Object.fromEntries(
    CABIN_SECTIONS[kind].fields.map((f) => [
      f.name,
      f.kind === 'strength' ? 0 : f.today ? todayStr() : '',
    ]),
  )
  return { ...base, kind } as CabinData
}
