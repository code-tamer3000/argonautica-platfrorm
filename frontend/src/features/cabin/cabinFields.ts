import type { CabinData, CabinKind } from '../../lib/types'

/** Описание одного поля формы подраздела. */
export interface FieldSpec {
  name: string
  label: string
  hint?: string
  /** short — однострочный input; long — textarea; strength — ползунок 0..10. */
  kind: 'short' | 'long' | 'strength'
}

/** Заголовки, подзаголовки и наборы полей для каждого подраздела «Каюты».
 *
 * Порядок полей = порядок столбцов в исходных таблицах автора. Первое поле
 * (date/age/topic) идёт в заголовок плашки. */
export const CABIN_SECTIONS: Record<
  CabinKind,
  { title: string; subtitle: string; fields: FieldSpec[]; titleField: string }
> = {
  diary: {
    title: 'Дневник эмоций',
    subtitle:
      'Фиксируйте триггерное событие и раскладывайте реакцию на составляющие: ' +
      'мысли, эмоции, телесные ощущения. Пишите коротко и по делу.',
    titleField: 'date',
    fields: [
      { name: 'date', label: 'Дата', kind: 'short', hint: 'например 27.09' },
      { name: 'trigger', label: 'Триггерное событие', hint: 'что произошло?', kind: 'long' },
      { name: 'thoughts', label: 'Автоматические мысли — установки', hint: 'что я думаю?', kind: 'long' },
      { name: 'emotion', label: 'Эмоция — жертва/палач', hint: 'что я чувствую?', kind: 'long' },
      { name: 'strength', label: 'Сила', kind: 'strength' },
      { name: 'body', label: 'Ощущение в теле — соматика', hint: 'как реагирует тело?', kind: 'long' },
      { name: 'reaction', label: 'Реакция — нездоровое поведение', hint: 'как я реагирую?', kind: 'long' },
      { name: 'recovery', label: 'Длительность цикла до восстановления', kind: 'short' },
    ],
  },
  trigger: {
    title: 'Триггеры',
    subtitle:
      'Построение гипотезы: корневые события прошлого, которые питают травму. ' +
      'Вместо даты — возраст, в конце — сформировавшийся паттерн.',
    titleField: 'age',
    fields: [
      { name: 'age', label: 'Возраст', kind: 'short', hint: 'например 5' },
      { name: 'trigger', label: 'Триггерное событие', hint: 'что произошло?', kind: 'long' },
      { name: 'thoughts', label: 'Автоматические мысли — установки', hint: 'что я думаю?', kind: 'long' },
      { name: 'emotion', label: 'Эмоция — жертва/палач', hint: 'что я чувствую?', kind: 'long' },
      { name: 'strength', label: 'Сила', kind: 'strength' },
      { name: 'body', label: 'Ощущение в теле — соматика', hint: 'как реагирует тело?', kind: 'long' },
      { name: 'reaction', label: 'Реакция — нездоровое поведение', hint: 'как я реагирую?', kind: 'long' },
      { name: 'pattern', label: 'Сформировавшийся паттерн', hint: 'как я поступаю сейчас?', kind: 'long' },
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

/** Пустая заготовка data для нового элемента подраздела. */
export function emptyData(kind: CabinKind): CabinData {
  const base = Object.fromEntries(
    CABIN_SECTIONS[kind].fields.map((f) => [f.name, f.kind === 'strength' ? 0 : '']),
  )
  return { ...base, kind } as CabinData
}
