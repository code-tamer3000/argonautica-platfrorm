import { useMemo, useRef, useState } from 'react'
import {
  useRoomMembers,
  useRemoveMember,
  useDeleteRoom,
  useSetGroupReadonly,
  useSetRoomAvatar,
} from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Drawer } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { IconEdit, IconTrash } from '../../components/icons'
import { mediaUpload } from '../../lib/mediaUpload'
import type { PublicUserOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import { AddMemberModal } from './AddMemberModal'
import { UserProfileModal } from './UserProfileModal'

interface Props {
  roomId: number
  isOwner?: boolean
  isReadonly?: boolean
  avatarUrl?: string | null
  roomName?: string
  onClose: () => void
  onOpenDm?: (roomId: number) => void
  onDeleted?: () => void
}

export function MembersDrawer({
  roomId,
  isOwner,
  isReadonly,
  avatarUrl,
  roomName,
  onClose,
  onOpenDm,
  onDeleted,
}: Props) {
  const { data: members, isLoading } = useRoomMembers(roomId, true)
  const remove = useRemoveMember(roomId)
  const deleteRoom = useDeleteRoom()
  const setReadonly = useSetGroupReadonly(roomId)
  const setAvatar = useSetRoomAvatar(roomId)
  const users = useUsersMap()
  const { user: me } = useAuth()
  const [picked, setPicked] = useState<PublicUserOut | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarFileRef = useRef<HTMLInputElement>(null)

  const canManageMembers = isOwner || me?.role === 'admin'
  const canDelete = isOwner || me?.role === 'admin'
  const canSetAvatar = isOwner || me?.role === 'admin'
  const isAdmin = me?.role === 'admin'

  const existingMemberIds = useMemo(
    () => new Set((members ?? []).map((m) => m.user_id)),
    [members],
  )

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setAvatarUploading(true)
    try {
      const { asset } = await mediaUpload(file)
      setAvatar.mutate(asset.id, {
        onSuccess: () => toast('Аватарка группы обновлена'),
        onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки', 'error')
    } finally {
      setAvatarUploading(false)
    }
  }

  function handleRemoveAvatar() {
    setAvatar.mutate(null, {
      onSuccess: () => toast('Аватарка удалена'),
      onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

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
      {canSetAvatar && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            paddingBottom: 16,
            marginBottom: 8,
            borderBottom: '1px solid var(--divider)',
          }}
        >
          {avatarUploading ? (
            <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner size={16} />
            </div>
          ) : (
            <Avatar name={roomName ?? 'Группа'} url={avatarUrl} square size={48} />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => avatarFileRef.current?.click()}
              disabled={avatarUploading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--divider)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <IconEdit size={14} /> Сменить фото
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={setAvatar.isPending}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--divider)',
                  background: 'transparent',
                  color: 'var(--blood-bright)',
                  cursor: 'pointer',
                }}
              >
                <IconTrash size={14} /> Удалить
              </button>
            )}
          </div>
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleAvatarChange}
          />
        </div>
      )}

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
              borderBottom: '1px solid var(--divider)',
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
            {canManageMembers && !isMe && (
              <button
                onClick={() => remove.mutate(member.user_id)}
                disabled={remove.isPending}
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--divider)',
                  background: 'transparent',
                  color: 'var(--blood-bright)',
                  cursor: 'pointer',
                }}
              >
                Удалить
              </button>
            )}
          </div>
        )
      })}

      {canManageMembers && (
        <div style={{ paddingTop: 16, marginTop: 8, borderTop: '1px solid var(--divider)' }}>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            style={{
              width: '100%',
              fontSize: 13,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--divider)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Добавить участника
          </button>
        </div>
      )}

      {isAdmin && (
        <div style={{ paddingTop: 16, marginTop: 8, borderTop: '1px solid var(--divider)' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              cursor: setReadonly.isPending ? 'default' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={isReadonly ?? false}
              disabled={setReadonly.isPending}
              onChange={(e) => setReadonly.mutate(e.target.checked)}
            />
            Только чтение — писать может только админ
          </label>
        </div>
      )}

      {canDelete && (
        <div style={{ paddingTop: 16, marginTop: 8, borderTop: '1px solid var(--divider)' }}>
          <button
            onClick={handleDeleteRoom}
            disabled={deleteRoom.isPending}
            style={{
              width: '100%',
              fontSize: 13,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--blood-bright)',
              background: 'transparent',
              color: 'var(--blood-bright)',
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

      {showAdd && (
        <AddMemberModal
          roomId={roomId}
          existingMemberIds={existingMemberIds}
          onClose={() => setShowAdd(false)}
        />
      )}
    </Drawer>
  )
}
