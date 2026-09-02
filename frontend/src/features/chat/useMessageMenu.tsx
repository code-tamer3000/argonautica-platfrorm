import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDeleteMessage } from '../../api/messages'
import { usePin } from '../../api/pins'
import { useToggleReaction } from '../../api/reactions'
import reactionIcon from '../../assets/reactions/star.webp'
import {
  IconCopy, IconEdit, IconNews, IconPin, IconReply, IconTrash, IconUsers,
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
  const navigate = useNavigate()
  const pin = usePin(roomId)
  const del = useDeleteMessage(roomId)
  const reaction = useToggleReaction(roomId)
  const [menu, setMenu] = useState<{ msg: MessageOut; anchor: DOMRect } | null>(null)

  // Смена комнаты закрывает открытое меню (его якорь уже неактуален).
  useEffect(() => { setMenu(null) }, [roomId])

  // Выпускник (graduated_at) в Рубке только читает: из меню остаётся копирование,
  // всё пишущее (ответ/правка/закреп/репост/удаление) убрано — бэкенд их и так
  // отбивает 403 (см. services/graduation.py).
  const isGraduated = !!user?.graduated_at

  function buildItems(msg: MessageOut): MenuItem[] {
    const items: MenuItem[] = []
    if (onReply && !isGraduated) {
      items.push({ key: 'reply', label: 'Ответить', icon: <IconReply size={18} />, onClick: () => onReply(msg) })
    }
    if (msg.content) {
      items.push({
        key: 'copy', label: 'Копировать текст', icon: <IconCopy size={18} />,
        onClick: () => { void navigator.clipboard?.writeText(msg.content ?? ''); toast('Скопировано') },
      })
    }
    if (user?.id === msg.sender_id && msg.content != null && !isGraduated) {
      items.push({ key: 'edit', label: 'Редактировать', icon: <IconEdit size={18} />, onClick: () => onEdit(msg) })
    }
    if (!isGraduated) {
      // Единственный способ поставить ПЕРВУЮ реакцию (пока чипа под сообщением
      // ещё нет) — дальше можно тапать по самому чипу (см. ReactionChip.tsx).
      items.push({
        key: 'reaction',
        label: msg.reacted_by_me ? 'Убрать реакцию' : 'Поставить реакцию',
        icon: <img src={reactionIcon} width={18} height={18} alt="" />,
        onClick: () => reaction.mutate(msg),
      })
    }
    if (canPin && !isGraduated) {
      items.push({ key: 'pin', label: 'Закрепить', icon: <IconPin size={18} />, onClick: () => pin.mutate(msg.id) })
    }
    if (onRepost && user?.role === 'admin' && !isNews && !isGraduated) {
      items.push({ key: 'repost', label: 'Репост в новости', icon: <IconNews size={18} />, onClick: () => onRepost(msg) })
    }
    // Автор сообщения → его карточка в «Аргонавтах». Своего профиля в ростере нет
    // (api/argonauts.py `_roster` исключает вызывающего) — на своих сообщениях
    // пункт не показываем. Чтение, а не запись: выпускнику (isGraduated) доступно.
    if (user?.id !== msg.sender_id) {
      items.push({
        key: 'profile',
        label: 'Посмотреть профиль',
        icon: <IconUsers size={18} />,
        onClick: () => navigate(`/argonauts/${msg.sender_id}`),
      })
    }
    if (!isGraduated && (user?.id === msg.sender_id || user?.role === 'admin')) {
      items.push({ key: 'delete', label: 'Удалить', icon: <IconTrash size={18} />, danger: true, onClick: () => del.mutate(msg.id) })
    }
    return items
  }

  // Стабильные ссылки: openMenu уходит в мемоизированный MessageItem как onOpenMenu —
  // нестабильная ссылка пробивала бы memo на каждом ре-рендере ленты.
  const openMenu = useCallback(
    (msg: MessageOut, anchor: DOMRect) => setMenu({ msg, anchor }),
    [],
  )
  const closeMenu = useCallback(() => setMenu(null), [])

  return {
    menu,
    openMenu,
    closeMenu,
    buildItems,
  }
}
