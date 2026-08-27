import { useMemo, useState } from 'react'
import { useAdminApplications } from '../../api/applications'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { Input } from '../../components/Input'
import { Drawer } from '../../components/Overlay'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import type { ApplicationOut, ApplicationStatus } from '../../lib/types'
import styles from './admin.module.css'
import funnelStyles from './funnel.module.css'

// Заявка «застряла», если висит в текущей стадии дольше этого порога (кроме
// confirmed — там воронка для неё уже кончилась).
const STUCK_THRESHOLD_DAYS = 3

// Терминальные стадии — воронка для заявки на них уже кончилась, «застрял»/«в
// работе» их не считают (confirmed — успех, expired — бронь сгорела, ARG-108).
const TERMINAL_STATUSES: ReadonlySet<ApplicationStatus> = new Set(['confirmed', 'expired'])

const STAGES: { status: ApplicationStatus; label: string; accent?: boolean }[] = [
  { status: 'awaiting_about', label: 'Ждём анкету' },
  { status: 'submitted', label: 'Анкета на проверке', accent: true },
  { status: 'choosing_plan', label: 'Выбирает тариф' },
  { status: 'awaiting_offer', label: 'Оферта' },
  { status: 'awaiting_receipt', label: 'Ждём чек' },
  { status: 'payment_review', label: 'Проверка оплаты', accent: true },
  { status: 'confirmed', label: 'Оплачено' },
  { status: 'expired', label: 'Бронь сгорела' },
]

const STAGE_LABEL: Record<ApplicationStatus, string> = Object.fromEntries(
  STAGES.map((s) => [s.status, s.label]),
) as Record<ApplicationStatus, string>

const TIMELINE_FIELDS: { key: keyof ApplicationOut; label: string }[] = [
  { key: 'created_at', label: 'Заявка создана' },
  { key: 'submitted_at', label: 'Анкета отправлена' },
  { key: 'accepted_at', label: 'Принята админом' },
  { key: 'plan_chosen_at', label: 'Тариф выбран' },
  { key: 'offer_accepted_at', label: 'Оферта принята' },
  { key: 'receipt_at', label: 'Чек прислан' },
  { key: 'confirmed_at', label: 'Оплата подтверждена' },
  { key: 'expired_at', label: 'Бронь сгорела' },
]

function formatDatetime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isStuck(item: ApplicationOut): boolean {
  return !TERMINAL_STATUSES.has(item.status) && (item.days_in_stage ?? 0) > STUCK_THRESHOLD_DAYS
}

function matchesQuery(item: ApplicationOut, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    item.display_name.toLowerCase().includes(q) ||
    (item.tg_username?.toLowerCase().includes(q) ?? false) ||
    (item.about?.toLowerCase().includes(q) ?? false)
  )
}

function ApplicationCard({ item, onOpen }: { item: ApplicationOut; onOpen: () => void }) {
  return (
    <button type="button" className={funnelStyles.card} onClick={onOpen}>
      <span className={funnelStyles.cardName}>{item.display_name}</span>
      {item.plan_name && <span className={funnelStyles.cardPlan}>{item.plan_name}</span>}
      <div className={funnelStyles.cardMeta}>
        <span className={funnelStyles.cardDays}>
          {item.days_in_stage != null ? `${item.days_in_stage} дн. в стадии` : '—'}
        </span>
        {isStuck(item) && <Chip kind="late">застрял</Chip>}
      </div>
    </button>
  )
}

function ApplicationDrawer({ item, onClose }: { item: ApplicationOut; onClose: () => void }) {
  return (
    <Drawer title={item.display_name} onClose={onClose}>
      <div className={funnelStyles.drawerSection}>
        <span className={funnelStyles.drawerLabel}>Контакт</span>
        <span className={funnelStyles.drawerValue}>
          {item.tg_username ? (
            <a
              className={funnelStyles.drawerLink}
              href={`https://t.me/${item.tg_username}`}
              target="_blank"
              rel="noreferrer"
            >
              @{item.tg_username}
            </a>
          ) : (
            'нет @username — бот не сможет создать аккаунт'
          )}
        </span>
      </div>

      <div className={funnelStyles.drawerSection}>
        <span className={funnelStyles.drawerLabel}>Стадия</span>
        <span className={funnelStyles.drawerValue}>{STAGE_LABEL[item.status]}</span>
      </div>

      {item.plan_name && (
        <div className={funnelStyles.drawerSection}>
          <span className={funnelStyles.drawerLabel}>Тариф</span>
          <span className={funnelStyles.drawerValue}>
            {item.plan_name}
            {item.plan_price != null ? ` — ${item.plan_price.toLocaleString('ru-RU')} ₽` : ''}
          </span>
        </div>
      )}

      {item.about && (
        <div className={funnelStyles.drawerSection}>
          <span className={funnelStyles.drawerLabel}>Анкета</span>
          <span className={funnelStyles.drawerValue}>{item.about}</span>
        </div>
      )}

      <div className={funnelStyles.drawerSection}>
        <span className={funnelStyles.drawerLabel}>Чек об оплате</span>
        <span className={funnelStyles.drawerValue}>
          {item.has_receipt
            ? `прислан (${item.receipt_kind === 'photo' ? 'фото' : 'PDF'}) — смотреть в Telegram`
            : 'нет'}
        </span>
      </div>

      {item.offer_version && (
        <div className={funnelStyles.drawerSection}>
          <span className={funnelStyles.drawerLabel}>Оферта</span>
          <span className={funnelStyles.drawerValue}>
            редакция {item.offer_version}, принята {formatDatetime(item.offer_accepted_at)}
          </span>
        </div>
      )}

      {item.user_id && (
        <div className={funnelStyles.drawerSection}>
          <span className={funnelStyles.drawerLabel}>Аккаунт платформы</span>
          <span className={funnelStyles.drawerValue}>создан (user #{item.user_id})</span>
        </div>
      )}

      <div className={funnelStyles.drawerSection}>
        <span className={funnelStyles.drawerLabel}>Таймлайн</span>
        <div className={funnelStyles.timeline}>
          {TIMELINE_FIELDS.map(({ key, label }) => {
            const value = item[key] as string | null
            return (
              <div key={key} className={funnelStyles.timelineRow}>
                <span className={funnelStyles.timelineStage}>{label}</span>
                <span className={value ? funnelStyles.timelineDate : funnelStyles.timelineDatePending}>
                  {formatDatetime(value)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </Drawer>
  )
}

export function AdminFunnel() {
  const { data, isLoading } = useAdminApplications()
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const items = data?.items ?? []
  const filtered = useMemo(
    () => items.filter((item) => matchesQuery(item, query)),
    [items, query],
  )
  const openItem = openId != null ? items.find((i) => i.id === openId) ?? null : null

  const byStatus = data?.by_status
  const stuckCount = items.filter(isStuck).length
  const working = data
    ? data.total - (byStatus?.awaiting_about ?? 0) - (byStatus?.confirmed ?? 0) - (byStatus?.expired ?? 0)
    : 0

  if (isLoading) return <div className="center grow"><Spinner /></div>

  return (
    <div className={styles.page}>
      <PageHeader title="Воронка" />

      <div className={funnelStyles.summaryRow}>
        <div className={funnelStyles.summaryItem}>
          <span className={funnelStyles.summaryValue}>{data?.total ?? 0}</span>
          <span className={funnelStyles.summaryLabel}>Всего заявок</span>
        </div>
        <div className={funnelStyles.summaryItem}>
          <span className={funnelStyles.summaryValue}>{working}</span>
          <span className={funnelStyles.summaryLabel}>В работе</span>
        </div>
        <div className={funnelStyles.summaryItem}>
          <span className={funnelStyles.summaryValue}>{byStatus?.confirmed ?? 0}</span>
          <span className={funnelStyles.summaryLabel}>Подтверждено</span>
        </div>
        <div className={funnelStyles.summaryItem}>
          <span className={`${funnelStyles.summaryValue} ${stuckCount > 0 ? funnelStyles.summaryValueAccent : ''}`}>
            {stuckCount}
          </span>
          <span className={funnelStyles.summaryLabel}>Застряли (&gt;{STUCK_THRESHOLD_DAYS} дн.)</span>
        </div>
      </div>

      <Input
        placeholder="Поиск по имени, @username или тексту анкеты"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className={funnelStyles.board}>
        {STAGES.map((stage) => {
          const stageItems = filtered.filter((item) => item.status === stage.status)
          return (
            <div
              key={stage.status}
              className={`${funnelStyles.column} ${stage.accent ? funnelStyles.columnAccent : ''}`}
            >
              <div className={funnelStyles.columnHead}>
                <span className={funnelStyles.columnTitle}>{stage.label}</span>
                <span className={funnelStyles.columnCount}>{byStatus?.[stage.status] ?? 0}</span>
              </div>
              <div className={funnelStyles.columnCards}>
                {stageItems.length === 0 ? (
                  <EmptyState size="inline">Пусто</EmptyState>
                ) : (
                  stageItems.map((item) => (
                    <ApplicationCard key={item.id} item={item} onOpen={() => setOpenId(item.id)} />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {openItem && <ApplicationDrawer item={openItem} onClose={() => setOpenId(null)} />}
    </div>
  )
}
