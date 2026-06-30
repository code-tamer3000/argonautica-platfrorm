import { useRoomMembers, useRemoveMember } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Drawer } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'

interface Props {
  roomId: number
  onClose: () => void
}

export function MembersDrawer({ roomId, onClose }: Props) {
  const { data: members, isLoading } = useRoomMembers(roomId, true)
  const remove = useRemoveMember(roomId)
  const users = useUsersMap()
  const { user: me } = useAuth()

  return (
    <Drawer title="Участники" onClose={onClose}>
      {isLoading && (
        <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <Spinner />
        </div>
      )}
      {members?.map((member) => {
        const u = users.get(member.user_id)
        const name = u?.display_name ?? `Участник #${member.user_id}`
        const isMe = member.user_id === me?.id
        return (
          <div
            key={member.user_id}
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
              alignItems: 'center',
            }}
          >
            <Avatar name={name} url={u?.avatar_url} size={32} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {name}{isMe ? ' (вы)' : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {member.role_in_room === 'owner' ? 'Владелец' : 'Участник'}
              </div>
            </div>
            {me?.role === 'admin' && !isMe && (
              <button
                onClick={() => remove.mutate(member.user_id)}
                disabled={remove.isPending}
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--danger, #e74c3c)',
                  cursor: 'pointer',
                }}
              >
                Удалить
              </button>
            )}
          </div>
        )
      })}
    </Drawer>
  )
}
