import { usePins, useUnpin } from '../../api/pins'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Drawer } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { timeHM } from '../../lib/format'

interface Props {
  roomId: number
  onClose: () => void
}

export function PinsDrawer({ roomId, onClose }: Props) {
  const { data, isLoading } = usePins(roomId, true)
  const unpin = useUnpin(roomId)
  const users = useUsersMap()

  return (
    <Drawer title="Закреплённые" onClose={onClose}>
      {isLoading && (
        <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <Spinner />
        </div>
      )}
      {data?.length === 0 && (
        <div style={{ padding: 16, color: 'var(--muted)', fontSize: 14 }}>
          Нет закреплённых сообщений
        </div>
      )}
      {data?.map((pin) => {
        const author = users.get(pin.message.sender_id)
        const name = author?.display_name ?? `Участник #${pin.message.sender_id}`
        return (
          <div
            key={pin.message_id}
            style={{
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <Avatar name={name} url={author?.avatar_url} size={28} />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'baseline',
                  marginBottom: 2,
                }}
              >
                <strong style={{ fontSize: 13 }}>{name}</strong>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {timeHM(pin.message.created_at)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: 'var(--muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 220,
                }}
              >
                {pin.message.content ??
                  (pin.message.sticker_id != null ? '[стикер]' : '[вложение]')}
              </div>
            </div>
            <button
              onClick={() => unpin.mutate(pin.message_id)}
              disabled={unpin.isPending}
              style={{
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--muted)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Открепить
            </button>
          </div>
        )
      })}
    </Drawer>
  )
}
