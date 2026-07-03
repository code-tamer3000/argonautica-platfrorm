import { useEffect, useState } from 'react'
import { useDeleteMessage } from '../../api/messages'
import { usePin } from '../../api/pins'
import {
  IconCopy, IconEdit, IconNews, IconPin, IconReply, IconTrash,
} from '../../components/icons'
import type { MessageOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import type { MenuItem } from './MessageActionsMenu'

interface Options {
  roomId: number
  isNews: boolean
  canPin: boolean
  // undefined → пункт «Ответить» не показываем (внутри треда — уже отвечаем, п.2).
  onReply?: (msg: MessageOut) => void
  onEdit: (msg: MessageOut) => void
  // Репост в новости: подхватывает сообщение в композер новостного канала (навигация
  // + pendingRepost). undefined → пункт репоста не показываем.
  onRepost?: (msg: MessageOut) => void
}

// Общая логика контекстного меню сообщения для ленты и треда. Видимость пунктов
// зеркалит правила бэкенда: править — только автор текста; удалять — автор или admin;
// репост в новости — admin и не из самого новостного канала.
export function useMessageMenu({ roomId, isNews, canPin, onReply, onEdit, onRepost }: Options) {
  const { user } = useAuth()
  const pin = usePin(roomId)
  const del = useDeleteMessage(roomId)
  const [menu, setMenu] = useState<{ msg: MessageOut; anchor: DOMRect } | null>(null)

  // Смена комнаты закрывает открытое меню (его якорь уже неактуален).
  useEffect(() => { setMenu(null) }, [roomId])

  function buildItems(msg: MessageOut): MenuItem[] {
    const items: MenuItem[] = []
    if (onReply) {
      items.push({ key: 'reply', label: 'Ответить', icon: <IconReply size={18} />, onClick: () => onReply(msg) })
    }
    if (msg.content) {
      items.push({
        key: 'copy', label: 'Копировать текст', icon: <IconCopy size={18} />,
        onClick: () => { void navigator.clipboard?.writeText(msg.content ?? ''); toast('Скопировано') },
      })
    }
    if (user?.id === msg.sender_id && msg.content != null) {
      items.push({ key: 'edit', label: 'Редактировать', icon: <IconEdit size={18} />, onClick: () => onEdit(msg) })
    }
    if (canPin) {
      items.push({ key: 'pin', label: 'Закрепить', icon: <IconPin size={18} />, onClick: () => pin.mutate(msg.id) })
    }
    if (onRepost && user?.role === 'admin' && !isNews) {
      items.push({ key: 'repost', label: 'Репост в новости', icon: <IconNews size={18} />, onClick: () => onRepost(msg) })
    }
    if (user?.id === msg.sender_id || user?.role === 'admin') {
      items.push({ key: 'delete', label: 'Удалить', icon: <IconTrash size={18} />, danger: true, onClick: () => del.mutate(msg.id) })
    }
    return items
  }

  return {
    menu,
    openMenu: (msg: MessageOut, anchor: DOMRect) => setMenu({ msg, anchor }),
    closeMenu: () => setMenu(null),
    buildItems,
  }
}
