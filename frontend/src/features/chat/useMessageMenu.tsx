import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDeleteMessage } from '../../api/messages'
import { usePin } from '../../api/pins'
import { useToggleReaction } from '../../api/reactions'
import reactionIcon from '../../assets/reactions/star.webp'
import {
  IconCopy, IconEdit, IconForward, IconPin, IconReply, IconThread, IconTrash, IconUsers,
} from '../../components/icons'
import type { MessageOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import type { MenuItem } from './MessageActionsMenu'

interface Options {
  roomId: number
  canPin: boolean
  // «Ответить» = цитата (Telegram-style, не тред — см. docs/MESSAGES.md «Quotes»).
  // undefined → пункт не показываем.
  onQuote?: (msg: MessageOut) => void
  // «Ответить в тред» — прежняя Slack-логика (аккордеон под корнем). undefined →
  // пункт не показываем (уже внутри треда — там снова отвечать в тред нельзя, п.2).
  onOpenThread?: (msg: MessageOut) => void
  onEdit: (msg: MessageOut) => void
  // Пересылка: открывает пикер комнаты, затем подхватывает сообщение в композер
  // выбранного чата (навигация + pendingForward). undefined → пункт не показываем.
  onForward?: (msg: MessageOut) => void
}

// Общая логика контекстного меню сообщения для ленты и треда. Видимость пунктов
// зеркалит правила бэкенда: править — только автор текста; удалять — автор или admin.
export function useMessageMenu({ roomId, canPin, onQuote, onOpenThread, onEdit, onForward }: Options) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const pin = usePin(roomId)
  const del = useDeleteMessage(roomId)
  const reaction = useToggleReaction(roomId)
  const [menu, setMenu] = useState<{ msg: MessageOut; anchor: DOMRect } | null>(null)

  // Смена комнаты закрывает открытое меню (его якорь уже неактуален).
  useEffect(() => { setMenu(null) }, [roomId])

  // Выпускник (graduated_at) в Рубке только читает: из меню остаётся копирование,
  // всё пишущее (ответ/цитата/правка/закреп/репост/удаление) убрано — бэкенд их
  // и так отбивает 403 (см. services/graduation.py).
  const isGraduated = !!user?.graduated_at

  function buildItems(msg: MessageOut): MenuItem[] {
    const items: MenuItem[] = []
    if (onQuote && !isGraduated) {
      items.push({ key: 'quote', label: 'Ответить', icon: <IconReply size={18} />, onClick: () => onQuote(msg) })
    }
    if (onOpenThread && !isGraduated) {
      items.push({ key: 'thread', label: 'Ответить в тред', icon: <IconThread size={18} />, onClick: () => onOpenThread(msg) })
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
    if (onForward && !isGraduated) {
      items.push({ key: 'forward', label: 'Переслать', icon: <IconForward size={18} />, onClick: () => onForward(msg) })
    }
    // Автор сообщения → его карточка в «Аргонавтах». На своих сообщениях пункт
    // не показываем — открывать профиль самого себя из меню сообщения не нужно,
    // даже когда своя плитка есть в общем ростере (см. ArgonautsScreen.tsx).
    // Чтение, а не запись: выпускнику (isGraduated) доступно. Держателю самого
    // дешёвого тарифа раздел закрыт целиком (rosterAccess) — пункт вёл бы в
    // редирект на главную, поэтому не показываем.
    if (user?.id !== msg.sender_id && !user?.is_cheap_tariff) {
      items.push({
        key: 'profile',
        label: 'Посмотреть профиль',
        icon: <IconUsers size={18} />,
        onClick: () => navigate(`/argonauts/${msg.sender_id}`),
      })
    }
    if (!isGraduated && (user?.id === msg.sender_id || user?.role === 'admin')) {
      items.push({
        key: 'delete',
        label: 'Удалить',
        icon: <IconTrash size={18} />,
        danger: true,
        onClick: () => {
          if (window.confirm('Удалить сообщение?')) del.mutate(msg.id)
        },
      })
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
