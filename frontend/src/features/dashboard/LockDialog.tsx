import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSetExpeditionLock } from '../../api/expedition'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import type { Element, LockOut, LockState } from '../../lib/types'
import { toast } from '../../stores/toast'
import { GeneKeyPicker } from '../genkeys/GeneKeyPicker'
import { Hexagram } from '../genkeys/Hexagram'
import { getKey } from '../genkeys/wheel'
import { elementName } from './wheelGeometry'
import styles from './lockDialog.module.css'

interface Props {
  element: Element
  state: LockState
  lock: LockOut | undefined
  onClose: () => void
}

// Ввод замка — идемпотентный upsert, не бросок: значение можно поправить, поэтому
// диалог всегда даёт «ввести заново», а не запирает результат намертво.
export function LockDialog({ element, state, lock, onClose }: Props) {
  const [picking, setPicking] = useState(state === 'unlockable')
  const setLock = useSetExpeditionLock()
  const navigate = useNavigate()

  const shownKeyNumber = setLock.data?.key_number ?? lock?.key_number
  const key = shownKeyNumber != null ? getKey(shownKeyNumber) : undefined

  const handlePick = (n: number) => {
    setLock.mutate(
      { element, keyNumber: n },
      {
        onError: () => toast('Не удалось сохранить — замок ещё не открыт или сеть подвела', 'error'),
        onSuccess: () => setPicking(false),
      },
    )
  }

  const openReading = () => {
    if (shownKeyNumber == null) return
    onClose()
    navigate(`/genkeys?key=${shownKeyNumber}`)
  }

  return (
    <Modal title={`Замок стихии «${elementName(element)}»`} onClose={onClose} closeOnBackdrop={false}>
      <div className={styles.body}>
        {picking ? (
          <>
            <p className={styles.lead}>
              {state === 'unlockable'
                ? 'Эфир этой стихии прошёл — можно ввести выпавшую вам гексаграмму.'
                : 'Замок можно поправить в любой момент — прежнее значение будет заменено.'}
            </p>
            <GeneKeyPicker onSelect={handlePick} />
            {setLock.isPending && (
              <div className={styles.saving}>
                <Spinner size={16} /> Сохраняем…
              </div>
            )}
          </>
        ) : key ? (
          <div className={styles.reading}>
            <div className={styles.readingHead}>
              <Hexagram pattern={key.hexagram} size={40} color="var(--accent-bright)" shimmer />
              <div>
                <div className={styles.readingNumber}>Ключ {key.number}</div>
                <div className={styles.readingName}>{key.name}</div>
              </div>
            </div>
            <div className={styles.spectrum}>
              <SpectrumBand label="Тень" value={key.shadow} />
              <SpectrumBand label="Дар" value={key.gift} />
              <SpectrumBand label="Сиддхи" value={key.siddhi} />
            </div>
            {state === 'entered' && (
              <p className={styles.hint}>
                Раскроется, когда будет принято задание этой стихии.
              </p>
            )}
            <div className={styles.actions}>
              <Button variant="outline" onClick={() => setPicking(true)}>
                Ввести заново
              </Button>
              <Button onClick={openReading}>Открыть разбор</Button>
            </div>
          </div>
        ) : (
          <p className={styles.lead}>Замок ещё ждёт своего этапа.</p>
        )}
      </div>
    </Modal>
  )
}

function SpectrumBand({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.band}>
      <div className={styles.bandLabel}>{label}</div>
      <div className={styles.bandValue}>{value}</div>
    </div>
  )
}
