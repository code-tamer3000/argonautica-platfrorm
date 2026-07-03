// Типы из контракта бэкенда (поля = ответы API). Держать в синхроне с backend/app/schemas.

export type Role = 'participant' | 'admin'
export type RoomType = 'dm' | 'group' | 'channel'
export type RoomRole = 'owner' | 'member'
export type MediaKind = 'image' | 'video' | 'file' | 'audio'

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface UserOut {
  id: number
  username: string
  email: string | null
  display_name: string
  avatar_url: string | null
  bio: string | null
  role: Role
  must_change_password: boolean
  can_create_groups: boolean
  settings: Record<string, unknown>
}

export interface PublicUserOut {
  id: number
  username: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  role: Role
}

export interface RoomOut {
  id: number
  type: RoomType
  name: string | null
  avatar_url: string | null
  created_at: string
  unread_count: number
  is_personal: boolean
  is_news: boolean
  created_by: number
  peer_id?: number
}

export interface MemberOut {
  room_id: number
  user_id: number
  role_in_room: RoomRole
  joined_at: string
}

export interface MessageOut {
  id: number
  room_id: number
  sender_id: number
  content: string | null
  sticker_id: number | null
  thread_root_id: number | null
  forwarded_from_sender_id: number | null
  reply_count: number
  last_reply_at: string | null
  created_at: string
  edited_at: string | null
  attachment_ids: number[]
}

export interface ThreadOut {
  root: MessageOut
  replies: MessageOut[]
}

export interface PinnedOut {
  room_id: number
  message_id: number
  pinned_by: number
  pinned_at: string
  message: MessageOut
}

export interface ReadStateOut {
  room_id: number
  last_read_message_id: number | null
  unread_count: number
}

export interface UploadTicket {
  upload_url: string
  bucket: string
  storage_key: string
  expires_in: number
}

export interface MediaAssetOut {
  id: number
  bucket: string
  storage_key: string
  kind: MediaKind
  mime_type: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  created_at: string
}

export interface MediaUrlOut {
  url: string
  expires_in: number
  kind: MediaKind
  duration: number | null
}

export interface KbItemOut {
  id: number
  category_id: number | null
  title: string
  body: string | null
  published: boolean
  created_by: number
  sort_order: number
  created_at: string
  updated_at: string
  media_asset_ids: number[]
}

export interface KbCommentOut {
  id: number
  kb_item_id: number
  author_id: number
  body: string
  created_at: string
}

export interface CalendarEventOut {
  id: number
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  room_id: number | null
  created_by: number
  created_at: string
}

export interface StickerOut {
  id: number
  pack_id: number
  image_url: string | null
  keyword: string | null
  sort_order: number
}

export interface StickerpackOut {
  id: number
  name: string
  created_by: number
  created_at: string
  stickers: StickerOut[]
}

export interface AdminCreateUserResponse {
  id: number
  username: string
  one_time_password: string
}

export interface AdminUserOut {
  id: number
  username: string
  display_name: string
  email: string | null
  role: Role
  can_create_groups: boolean
  is_active: boolean
  created_at: string
}

// --- WebSocket события ---
export type WsEvent =
  | { type: 'message.new'; message: MessageOut }
  | { type: 'message.edited'; message: MessageOut }
  | { type: 'message.deleted'; room_id: number; message_id: number }
  | { type: 'pin.added'; room_id: number; message_id: number; pinned_by: number }
  | { type: 'pin.removed'; room_id: number; message_id: number }
  | { type: 'read'; room_id: number; user_id: number; last_read_message_id: number | null }
  | { type: 'typing'; room_id: number; user_id: number }
  | { type: 'presence'; user_id: number; status: 'online' | 'offline' }
  | { type: 'subscribed'; room_id: number }
  | { type: 'unsubscribed'; room_id: number }
  | { type: 'error'; detail: string; room_id?: number }
  | { type: 'pong' }
