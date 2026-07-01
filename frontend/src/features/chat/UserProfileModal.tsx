import { useCreateRoom } from '../../api/rooms'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import type { PublicUserOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import styles from './chat.module.css'

interface Props {
  profile: PublicUserOut
  onClose: () => void
  // Открыть DM с этим пользователем (создаёт/находит комнату и выбирает её).
  onOpenDm?: (roomId: number) => void
}

const roleLabel = (role: string): string =>
  role === 'admin' ? 'Администратор' : 'Участник'

export function UserProfileModal({ profile, onClose, onOpenDm }: Props) {
  const { user: me } = useAuth()
  const createRoom = useCreateRoom()
  const setDmPeer = useUiStore((s) => s.setDmPeer)
  const isMe = me?.id === profile.id

  async function handleWrite() {
    try {
      const room = await createRoom.mutateAsync({ type: 'dm', peer_id: profile.id })
      setDmPeer(room.id, profile.id)
      onOpenDm?.(room.id)
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось открыть чат', 'error')
    }
  }

  return (
    <Modal title="Профиль" onClose={onClose}>
      <div className={styles.profileCard}>
        <Avatar name={profile.display_name} url={profile.avatar_url} size={88} />
        <div className={styles.profileName}>{profile.display_name}</div>
        <div className={styles.profileUsername}>@{profile.username}</div>
        <div className={styles.profileRole}>{roleLabel(profile.role)}</div>
        {profile.bio && <div className={styles.profileBio}>{profile.bio}</div>}
        {!isMe && (
          <Button variant="gold" onClick={handleWrite} disabled={createRoom.isPending}>
            {createRoom.isPending ? <Spinner size={16} /> : 'Написать сообщение'}
          </Button>
        )}
      </div>
    </Modal>
  )
}
