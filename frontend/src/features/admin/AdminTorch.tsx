import { useEffect, useMemo, useState } from 'react'
import {
  useAdminTorch,
  useGrantTorch,
  useRevokeTorch,
  useUpdateTorchStub,
} from '../../api/torch'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { PageHeader } from '../../components/PageHeader'
import { toast } from '../../stores/toast'
import styles from './admin.module.css'

/**
 * Клуб «Факел» в панели админа: кому открыть, кому уже открыт, и общий текст
 * заглушки для тех, у кого тумблер ещё выключен (ARG-54).
 *
 * Список — только выпустившиеся (`GET /api/admin/torch` уже фильтрует их на
 * бэкенде): до выпуска пункт меню скрыт, включать тут просто некого.
 */
export function AdminTorch() {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [stubDraft, setStubDraft] = useState('')

  const { data, isLoading } = useAdminTorch()
  const grant = useGrantTorch()
  const revoke = useRevokeTorch()
  const updateStub = useUpdateTorchStub()

  useEffect(() => {
    if (data) setStubDraft(data.stub_text)
  }, [data])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (r) =>
        r.display_name.toLowerCase().includes(needle) ||
        r.username.toLowerCase().includes(needle),
    )
  }, [rows, q])

  function toggle(userId: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function toggleAll() {
    const candidates = filtered.filter((r) => !r.torch_unlocked).map((r) => r.user_id)
    setPicked((prev) =>
      candidates.every((id) => prev.has(id)) ? new Set() : new Set(candidates),
    )
  }

  function handleGrant() {
    grant.mutate([...picked], {
      onSuccess: () => {
        toast(`Клуб открыт: ${picked.size}`)
        setPicked(new Set())
      },
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  function handleSaveStub() {
    updateStub.mutate(stubDraft, {
      onSuccess: () => toast('Текст заглушки сохранён'),
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  if (isLoading || !data) {
    return (
      <div className={styles.page}>
        <Spinner />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Факел">
        <span className={styles.listMeta}>
          Открыт: {rows.filter((r) => r.torch_unlocked).length} из {rows.length}
        </span>
      </PageHeader>

      <p className={styles.listDescription}>
        Постоянный ручной тумблер, независимый от подписки. Пока он выключен,
        выпустившийся видит только текст заглушки ниже; включение добавляет его в
        общий чат клуба.
      </p>

      <div className={styles.listItem} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label className={styles.listMeta} htmlFor="torch-stub">
          Текст заглушки (один на всех закрытых)
        </label>
        <textarea
          id="torch-stub"
          className={styles.input}
          rows={3}
          value={stubDraft}
          onChange={(e) => setStubDraft(e.target.value)}
        />
        <div className={styles.listActions}>
          <Button
            variant="gold"
            disabled={updateStub.isPending || stubDraft.trim() === '' || stubDraft === data.stub_text}
            onClick={handleSaveStub}
          >
            Сохранить текст
          </Button>
        </div>
      </div>

      <input
        className={styles.input}
        placeholder="Поиск по имени или username"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className={styles.listActions}>
        <Button variant="outline" onClick={toggleAll}>
          Выбрать всех закрытых
        </Button>
        <Button
          variant="gold"
          disabled={picked.size === 0 || grant.isPending}
          onClick={handleGrant}
        >
          Открыть клуб ({picked.size})
        </Button>
      </div>

      <div className={styles.list}>
        {filtered.length === 0 ? (
          <p className={styles.mediaEmpty}>Пока никто не выпустился.</p>
        ) : (
          filtered.map((r) => (
            <div className={styles.listItem} key={r.user_id}>
              <div className={styles.listItemMain}>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={picked.has(r.user_id)}
                    disabled={r.torch_unlocked}
                    onChange={() => toggle(r.user_id)}
                  />
                  <span>
                    {r.display_name}{' '}
                    <span className={styles.listMeta}>@{r.username}</span>
                  </span>
                </label>
              </div>
              <div className={styles.listActions}>
                <Badge tone={r.torch_unlocked ? 'accent' : 'neutral'}>
                  {r.torch_unlocked ? 'Клуб открыт' : 'Заглушка'}
                </Badge>
                {r.torch_unlocked && (
                  <Button
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate(r.user_id, {
                        onSuccess: () => toast('Доступ закрыт'),
                      })
                    }
                  >
                    Закрыть
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
