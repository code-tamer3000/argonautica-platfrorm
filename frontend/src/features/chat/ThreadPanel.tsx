import { useState } from 'react'
import { useSendMessage } from '../../api/messages'
import { useThread } from '../../api/threads'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Drawer } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { timeHM } from '../../lib/format'
import type { MessageOut, PublicUserOut } from '../../lib/types'

function ThreadMsg({ msg, users }: { msg: MessageOut; users: Map<number, PublicUserOut> }) {
  const author = users.get(msg.sender_id)
  const name = author?.display_name ?? `Участник #${msg.sender_id}`
  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <Avatar name={name} url={author?.avatar_url} size={28} />
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <strong style={{ fontSize: 13 }}>{name}</strong>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{timeHM(msg.created_at)}</span>
        </div>
        {msg.content && <div style={{ fontSize: 14, marginTop: 2 }}>{msg.content}</div>}
        {msg.sticker_id != null && <div style={{ fontSize: 13, color: 'var(--muted)' }}>[стикер]</div>}
        {msg.attachment_ids.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            [вложений: {msg.attachment_ids.length}]
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  roomId: number
  rootId: number
  onClose: () => void
}

export function ThreadPanel({ roomId, rootId, onClose }: Props) {
  const { data, isLoading } = useThread(roomId, rootId)
  const [text, setText] = useState('')
  const send = useSendMessage(roomId)
  const users = useUsersMap()

  function handleSend() {
    if (!text.trim() || send.isPending) return
    send.mutate({ content: text.trim(), reply_to_message_id: rootId })
    setText('')
  }

  return (
    <Drawer title="Тред" onClose={onClose}>
      {isLoading && (
        <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <Spinner />
        </div>
      )}
      {data && (
        <>
          <ThreadMsg msg={data.root} users={users} />
          {data.replies.map((r) => (
            <ThreadMsg key={r.id} msg={r} users={users} />
          ))}
        </>
      )}
      <div
        style={{
          padding: '12px 0 0',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 8,
        }}
      >
        <textarea
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            borderRadius: 6,
            padding: '6px 8px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 13,
          }}
          placeholder="Ответить в тред…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || send.isPending}
          style={{
            padding: '0 12px',
            borderRadius: 6,
            background: 'var(--gold)',
            color: '#000',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Ответить
        </button>
      </div>
    </Drawer>
  )
}
