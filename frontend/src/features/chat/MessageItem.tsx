import { Avatar } from '../../components/Avatar'
import { timeHM } from '../../lib/format'
import type { MessageOut, PublicUserOut } from '../../lib/types'
import styles from './chat.module.css'

interface Props {
  msg: MessageOut
  continuation: boolean
  author?: PublicUserOut
}

export function MessageItem({ msg, continuation, author }: Props) {
  const name = author?.display_name ?? `Участник #${msg.sender_id}`
  return (
    <div className={`${styles.msg} ${continuation ? styles.msgContinuation : ''}`}>
      <div className={styles.msgAvatar}>
        {!continuation && <Avatar name={name} url={author?.avatar_url} size={36} />}
      </div>
      <div className={styles.msgBody}>
        {!continuation && (
          <div className={styles.msgHead}>
            <span className={styles.msgAuthor}>{name}</span>
            <span className={styles.msgTime}>{timeHM(msg.created_at)}</span>
          </div>
        )}
        {msg.content && <div className={styles.msgText}>{msg.content}</div>}
        {msg.sticker_id != null && (
          <div className={`${styles.msgText} ${styles.msgPlaceholder}`}>[стикер]</div>
        )}
        {msg.attachment_ids.length > 0 && (
          <div className={`${styles.msgText} ${styles.msgPlaceholder}`}>
            [вложений: {msg.attachment_ids.length}]
          </div>
        )}
        {(msg.edited_at || msg.reply_count > 0) && (
          <div className={styles.msgMeta}>
            {msg.edited_at ? 'изменено' : ''}
            {msg.edited_at && msg.reply_count > 0 ? ' · ' : ''}
            {msg.reply_count > 0 ? `${msg.reply_count} ответ(ов)` : ''}
          </div>
        )}
      </div>
    </div>
  )
}
