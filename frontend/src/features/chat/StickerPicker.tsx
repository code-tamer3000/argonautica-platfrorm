import { useStickerpacks } from '../../api/stickers'
import { Spinner } from '../../components/Spinner'
import styles from './chat.module.css'

export function StickerPicker({ onPick }: { onPick: (id: number) => void }) {
  const { data, isLoading } = useStickerpacks()
  return (
    <div className={styles.pickerPop}>
      {isLoading && (
        <div className="center" style={{ padding: 16 }}>
          <Spinner size={18} />
        </div>
      )}
      {data && data.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Стикерпаков нет</div>}
      {data?.map((pack) => (
        <div key={pack.id} className={styles.pickerPack}>
          <div className="label">{pack.name}</div>
          <div className={styles.pickerGrid}>
            {pack.stickers.map(
              (s) =>
                s.image_url && (
                  <img
                    key={s.id}
                    className={styles.pickerSticker}
                    src={s.image_url}
                    alt={s.keyword ?? ''}
                    onClick={() => onPick(s.id)}
                  />
                ),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
