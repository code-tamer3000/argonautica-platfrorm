import { useConnectionStatus } from './useConnectionStatus'

interface OfflineEmptyInput {
  isLoading: boolean
  isError: boolean
  dataUpdatedAt: number
  isEmpty: boolean
}

// Отличает «список пуст по факту» от «мы не смогли ничего загрузить, потому
// что нет сети». dataUpdatedAt===0 — двойной сигнал: либо запрос ни разу не
// завершился успешно, либо это первый рендер после restoreQueryCache
// (queryPersist.ts помечает восстановленные данные updatedAt:0 до первого
// подтверждающего рефетча). Проверяем isEmpty, чтобы не мешать честному
// офлайн-рендеру НЕпустых списков из персиста (ARG-147) — если данные есть,
// это не наша забота.
export function useIsOfflineEmpty({ isLoading, isError, dataUpdatedAt, isEmpty }: OfflineEmptyInput): boolean {
  const connection = useConnectionStatus()
  if (isLoading || !isEmpty) return false
  if (dataUpdatedAt > 0) return false
  return isError || connection !== 'online'
}
