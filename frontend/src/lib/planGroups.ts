/** Группировка произвольных сущностей (комнаты-дневники, пользователи, заявки
 * воронки) по тарифу. Единственное место, где живут правила порядка групп:
 * как в списке тарифов (он отсортирован по цене — и `/api/plans`, и
 * `/api/admin/plans`), «Без тарифа» всегда последней, тариф, выпавший из списка
 * (стал неактивным / удалён), падает в конец перед «Без тарифа» с именем,
 * денормализованным в самой сущности. */

/** Минимум, который нужен от тарифа для сортировки групп — подходит и PlanOut, и PlanPublicOut. */
export interface PlanRef {
  id: number
  name: string
}

export const NO_PLAN_KEY = 'none'
export const NO_PLAN_LABEL = 'Без тарифа'

export interface PlanGroup<T> {
  /** id тарифа строкой либо `NO_PLAN_KEY` — годится как React key. */
  key: string
  label: string
  items: T[]
}

export function groupByPlan<T>(
  items: T[],
  plans: PlanRef[],
  getPlan: (item: T) => { id: number | null; name: string | null },
): PlanGroup<T>[] {
  const order = new Map(plans.map((p, i) => [p.id, i]))
  const buckets = new Map<string, T[]>()
  const labels = new Map<string, string>()
  for (const item of items) {
    const { id, name } = getPlan(item)
    const key = id != null ? String(id) : NO_PLAN_KEY
    const list = buckets.get(key)
    if (list) list.push(item)
    else buckets.set(key, [item])
    if (key !== NO_PLAN_KEY && !labels.has(key)) {
      labels.set(key, name ?? plans.find((p) => p.id === id)?.name ?? 'Тариф')
    }
  }
  return [...buckets.entries()]
    .map(([key, groupItems]) => ({
      key,
      label: key === NO_PLAN_KEY ? NO_PLAN_LABEL : (labels.get(key) ?? 'Тариф'),
      items: groupItems,
    }))
    .sort((a, b) => {
      if (a.key === NO_PLAN_KEY) return 1
      if (b.key === NO_PLAN_KEY) return -1
      return (
        (order.get(Number(a.key)) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(Number(b.key)) ?? Number.MAX_SAFE_INTEGER)
      )
    })
}
