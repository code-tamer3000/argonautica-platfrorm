import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { cabinKey } from '../api/cabin'
import {
  configureCabinOutbox,
  flushCabin,
  hydrateCabinOutbox,
  optimisticCabinEntry,
  type CabinOutboxItem,
} from '../lib/cabinOutbox'
import type { CabinEntryOut } from '../lib/types'

// Инициализация outbox'а Каюты: связывает фоновый воркер (вне React) с кэшем
// Query и поднимает незавершённые записи прошлой сессии. Монтируется один раз —
// внутри CabinScreen, пока раздел открыт.

// ─── Мутации кэша списка записей подраздела ──────────────────────────────────

// Вставить/обновить оптимистичную запись. Для create (id < 0) — в начало списка;
// для update (id > 0) — заменить существующую по id.
function upsertOptimistic(qc: QueryClient, item: CabinOutboxItem): void {
  const entry = optimisticCabinEntry(item)
  qc.setQueryData<CabinEntryOut[]>(cabinKey(item.kind), (prev) => {
    const list = prev ?? []
    if (item.realId != null) {
      return list.map((e) => (e.id === item.realId ? entry : e))
    }
    return [entry, ...list]
  })
}

// Заменить оптимистичную запись настоящей с сервера (по clientId в _outbox).
function resolveOptimistic(qc: QueryClient, item: CabinOutboxItem, real: CabinEntryOut): void {
  qc.setQueryData<CabinEntryOut[]>(cabinKey(item.kind), (prev) => {
    if (!prev) return [real]
    return prev.map((e) => (e._outbox?.clientId === item.clientId ? real : e))
  })
  // На всякий случай синхронизируемся с сервером (порядок, updated_at и т.п.).
  void qc.invalidateQueries({ queryKey: cabinKey(item.kind) })
}

// Пометить статус доставки оптимистичной записи (pending/failed).
function markStatus(qc: QueryClient, item: CabinOutboxItem, status: 'pending' | 'failed'): void {
  qc.setQueryData<CabinEntryOut[]>(cabinKey(item.kind), (prev) =>
    (prev ?? []).map((e) =>
      e._outbox?.clientId === item.clientId
        ? { ...e, _outbox: { clientId: item.clientId, status } }
        : e,
    ),
  )
}

// Убрать оптимистичную запись (пользователь отменил зависшую).
function dropOptimistic(qc: QueryClient, item: CabinOutboxItem): void {
  qc.setQueryData<CabinEntryOut[]>(cabinKey(item.kind), (prev) =>
    (prev ?? []).filter((e) => e._outbox?.clientId !== item.clientId),
  )
}

export function useCabinOutbox(): void {
  const qc = useQueryClient()

  useEffect(() => {
    configureCabinOutbox({
      enqueue: (item) => upsertOptimistic(qc, item),
      resolve: (item, real) => resolveOptimistic(qc, item, real),
      status: (item, status) => markStatus(qc, item, status),
      drop: (item) => dropOptimistic(qc, item),
    })

    void hydrateCabinOutbox().then((items) => {
      for (const item of items) upsertOptimistic(qc, item)
      flushCabin()
    })
  }, [qc])

  useEffect(() => {
    const onOnline = () => flushCabin()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])
}
