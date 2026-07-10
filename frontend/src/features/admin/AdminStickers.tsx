import { useRef, useState } from 'react'
import { useCreatePack, useStickerpacks, useAddSticker } from '../../api/stickers'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { mediaUpload } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import type { MediaAssetOut, StickerpackOut } from '../../lib/types'
import styles from './admin.module.css'

function PackRow({ pack }: { pack: StickerpackOut }) {
  const addSticker = useAddSticker(pack.id)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingAsset, setPendingAsset] = useState<MediaAssetOut | null>(null)
  const [keyword, setKeyword] = useState('')

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // reset so the same file can be picked again
    e.target.value = ''
    try {
      const { asset } = await mediaUpload(file)
      setPendingAsset(asset)
      setKeyword('')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки', 'error')
    }
  }

  function handleAddSticker() {
    if (!pendingAsset) return
    addSticker.mutate(
      { image_media_id: pendingAsset.id, keyword: keyword.trim() || undefined },
      {
        onSuccess: () => {
          toast('Стикер добавлен')
          setPendingAsset(null)
          setKeyword('')
        },
        onError: (err: unknown) => {
          toast(err instanceof Error ? err.message : 'Ошибка', 'error')
        },
      },
    )
  }

  return (
    <div className={styles.listItem} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
      <div className={styles.listItemMain} style={{ width: '100%' }}>
        <span className={styles.listTitle}>{pack.name}</span>
        <div className={styles.listActions} style={{ marginLeft: 'auto' }}>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            Добавить стикер
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {pack.stickers.length > 0 && (
        <div className={styles.stickerGrid}>
          {pack.stickers.map((sticker) => (
            <div key={sticker.id} title={sticker.keyword ?? undefined}>
              {sticker.image_url ? (
                <img
                  src={sticker.image_url}
                  alt={sticker.keyword ?? 'sticker'}
                  className={styles.stickerImg}
                />
              ) : (
                <div
                  className={styles.stickerImg}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.6rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  [нет фото]
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingAsset && (
        <Modal title="Добавить стикер" onClose={() => setPendingAsset(null)}>
          <div className={styles.form}>
            <div
              style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--divider)', borderRadius: 'var(--radius-btn)', color: 'var(--text-secondary)', fontSize: '0.75rem' }}
            >
              {pendingAsset.mime_type}
            </div>
            <div className={styles.formRow}>
              <label>Ключевое слово (необязательно)</label>
              <input
                className={styles.input}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="например: smile"
              />
            </div>
            <div className={styles.formActions}>
              <Button variant="outline" onClick={() => setPendingAsset(null)}>
                Отмена
              </Button>
              <Button onClick={handleAddSticker} disabled={addSticker.isPending}>
                {addSticker.isPending ? 'Добавляем…' : 'Добавить'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function AdminStickers() {
  const { data: packs = [] } = useStickerpacks()
  const createPack = useCreatePack()
  const [createOpen, setCreateOpen] = useState(false)
  const [packName, setPackName] = useState('')

  function handleCreatePack() {
    const name = packName.trim()
    if (!name) return
    createPack.mutate(name, {
      onSuccess: () => {
        toast('Пак создан')
        setPackName('')
        setCreateOpen(false)
      },
      onError: (err: unknown) => {
        toast(err instanceof Error ? err.message : 'Ошибка', 'error')
      },
    })
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Стикерпаки</h1>
        <Button onClick={() => setCreateOpen(true)}>Создать пак</Button>
      </div>

      <div className={styles.list}>
        {packs.map((pack) => (
          <PackRow key={pack.id} pack={pack} />
        ))}
        {packs.length === 0 && (
          <p style={{ color: 'var(--text-secondary)' }}>Паков пока нет.</p>
        )}
      </div>

      {createOpen && (
        <Modal title="Новый стикерпак" onClose={() => setCreateOpen(false)}>
          <div className={styles.form}>
            <div className={styles.formRow}>
              <label>Название</label>
              <input
                className={styles.input}
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
                placeholder="Название пака"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreatePack()}
              />
            </div>
            <div className={styles.formActions}>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Отмена
              </Button>
              <Button onClick={handleCreatePack} disabled={createPack.isPending || !packName.trim()}>
                {createPack.isPending ? 'Создаём…' : 'Создать'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
