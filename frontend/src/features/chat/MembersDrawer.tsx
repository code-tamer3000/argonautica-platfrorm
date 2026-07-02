import { useState } from 'react'
import { useRoomMembers, useRemoveMember, useDeleteRoom } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Drawer } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import type { PublicUserOut } from '../../lib/types'
import { useAuth } from '../auth/AuthContext'
import { UserProfileModal } from './UserProfileModal'

interface Props {
  roomId: number
  isOwner?: boolean
  onClose: () => void
  onOpenDm?: (roomId: number) => void
  onDeleted?: () => void
}

export function MembersDrawer({ roomId, isOwner, onClose, onOpenDm, onDeleted }: Props) {
  const { data: members, isLoading } = useRoomMembers(roomId, true)
  const remove = useRemoveMember(roomId)
  const deleteRoom = useDeleteRoom()
  const users = useUsersMap()
  const { user: me } = useAuth()
  const [picked, setPicked] = useState<PublicUserOut | null>(null)

  const canDelete = isOwner || me?.role === 'admin'

  const handleDeleteRoom = () => {
    if (!window.confirm('Удалить группу безвозвратно? Это удалит все сообщения и вложения.')) {
      return
    }
    deleteRoom.mutate(roomId, {
      onSuccess: () => {
        onClose()
        onDeleted?.()
      },
    })
  }

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
            <button
              onClick={() => u && setPicked(u)}
              disabled={!u}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flex: 1,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: u ? 'pointer' : 'default',
                textAlign: 'left',
                color: 'inherit',
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
            </button>
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

      {canDelete && (
        <div style={{ paddingTop: 16, marginTop: 8, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleDeleteRoom}
            disabled={deleteRoom.isPending}
            style={{
              width: '100%',
              fontSize: 13,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--danger, #e74c3c)',
              background: 'transparent',
              color: 'var(--danger, #e74c3c)',
              cursor: 'pointer',
            }}
          >
            Удалить группу
          </button>
        </div>
      )}

      {picked && (
        <UserProfileModal
          profile={picked}
          onClose={() => setPicked(null)}
          onOpenDm={(id) => {
            setPicked(null)
            onClose()
            onOpenDm?.(id)
          }}
        />
      )}
    </Drawer>
  )
}
