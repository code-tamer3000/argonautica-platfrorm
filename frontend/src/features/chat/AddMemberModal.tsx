import { useMemo, useState } from 'react'
import { useAddMember } from '../../api/rooms'
import { useTorchContacts } from '../../api/torch'
import { useContacts } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { contactPlanKey, groupPreOrdered } from '../../lib/planGroups'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import styles from './chat.module.css'

interface Props {
  roomId: number
  existingMemberIds: Set<number>
  // Группа раздела «Факел» (ARG-54, часть 2) — другой источник контактов и круг
  // видимости на бэке (`assert_torch_peer_visible`, выводится сервером из
  // `rooms.torch_scope` — этот проп только выбирает правильный список кандидатов).
  torch?: boolean
  onClose: () => void
}

// Один клик — один участник (POST /rooms/{id}/members идемпотентен, но добавление
// пачкой за раз в эту задачу не входит, см. «Границы» ARG-154).
export function AddMemberModal({ roomId, existingMemberIds, torch = false, onClose }: Props) {
  const { user: me } = useAuth()
  const adminCurrentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const { data: regularContacts, isLoading: regularLoading } = useContacts(
    me?.role === 'admin' ? adminCurrentIntakeId : undefined,
    !torch,
  )
  const { data: torchContacts, isLoading: torchLoading } = useTorchContacts(torch)
  const users = torch ? torchContacts : regularContacts
  const isLoading = torch ? torchLoading : regularLoading
  const addMember = useAddMember(roomId)
  const [q, setQ] = useState('')
  const [pendingId, setPendingId] = useState<number | null>(null)

  const candidates = useMemo(
    () => (users ?? []).filter((u) => !existingMemberIds.has(u.id)),
    [users, existingMemberIds],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return candidates
    return candidates.filter(
      (u) =>
        u.display_name.toLowerCase().includes(needle) ||
        u.username.toLowerCase().includes(needle),
    )
  }, [candidates, q])

  const groups = useMemo(() => groupPreOrdered(filtered, contactPlanKey), [filtered])

  function handleAdd(userId: number) {
    setPendingId(userId)
    addMember.mutate(userId, {
      onSuccess: () => {
        toast('Участник добавлен')
        onClose()
      },
      onError: (err) => toast(err instanceof Error ? err.message : 'Не удалось добавить', 'error'),
      onSettled: () => setPendingId(null),
    })
  }

  return (
    <Modal title="Добавить участника" onClose={onClose}>
      <input
        className={styles.search}
        placeholder="Поиск участника"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      <div className={styles.userList}>
        {isLoading && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner />
          </div>
        )}
        {users && filtered.length === 0 && (
          <div className={styles.emptyUsers}>Никого не найдено</div>
        )}
        {groups.map((group) => (
          <div key={group.key}>
            {groups.length > 1 && (
              <div className={styles.userSectionHead}>
                <span className={styles.userSectionTitle}>{group.label}</span>
              </div>
            )}
            {group.items.map((u) => (
              <button
                key={u.id}
                type="button"
                className={styles.userRow}
                onClick={() => handleAdd(u.id)}
                disabled={addMember.isPending}
              >
                <Avatar name={u.display_name} url={u.avatar_url} size={36} />
                <div className={styles.userRowMain}>
                  <div className={styles.userRowName}>{u.display_name}</div>
                  <div className={styles.userRowSub}>@{u.username}</div>
                </div>
                {pendingId === u.id && addMember.isPending && <Spinner size={16} />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}
