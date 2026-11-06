import { useMemo, useState } from 'react'
import { useAdminIntakes } from '../../api/admin'
import { useAdminApplications } from '../../api/applications'
import { useAdminPlans } from '../../api/plans'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { Input } from '../../components/Input'
import { Drawer } from '../../components/Overlay'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { groupByPlan } from '../../lib/planGroups'
import type { ApplicantKind, ApplicationOut, ApplicationStatus } from '../../lib/types'
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

const KIND_LABEL: Record<ApplicantKind, string> = {
  new: 'Новые',
  retry: 'Подавались раньше',
  returning: 'Прошли экспедицию',
}

const KIND_ORDER: ApplicantKind[] = ['new', 'retry', 'returning']

/** `YYYY-MM-DD` → «2 июня 2026». Дата потока календарная, без часовых поясов. */
function intakeDate(startsOn: string): string {
  return new Date(`${startsOn}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

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
      {item.applicant_kind && (
        <span className={funnelStyles.cardPlan}>{KIND_LABEL[item.applicant_kind]}</span>
      )}
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

      {item.applicant_kind && (
        <div className={funnelStyles.drawerSection}>
          <span className={funnelStyles.drawerLabel}>Заявитель</span>
          <span className={funnelStyles.drawerValue}>{KIND_LABEL[item.applicant_kind]}</span>
        </div>
      )}

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
  // Поток: по умолчанию самый новый (первый в списке), архив — через селектор (ARG-189).
  const { data: intakes = [], isSuccess: intakesLoaded } = useAdminIntakes()
  const [intakeChoice, setIntakeChoice] = useState<number | 'all' | null>(null)
  const selectedIntake: number | 'all' | null =
    intakeChoice ?? (intakes.length > 0 ? intakes[0].id : null)
  const { data, isLoading } = useAdminApplications(
    selectedIntake === 'all' ? null : selectedIntake,
    intakesLoaded, // пока список потоков не пришёл, «все потоки» не запрашиваем
  )
  // Тарифы задают порядок групп в колонках (по цене) — берём админский список,
  // чтобы заявка на уже выключенном тарифе не теряла своё место.
  const { data: plans = [] } = useAdminPlans()
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

      {intakes.length > 0 && (
        <div className={styles.formRow} style={{ maxWidth: 420 }}>
          <label htmlFor="funnel_intake_filter">Поток</label>
          <select
            id="funnel_intake_filter"
            className={styles.input}
            value={String(selectedIntake)}
            onChange={(e) => setIntakeChoice(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            {intakes.map((intake, index) => (
              <option key={intake.id} value={intake.id}>
                {intakeDate(intake.starts_on)}
                {index === 0 ? ' — новый' : ' — архив'}
              </option>
            ))}
            <option value="all">Все потоки</option>
          </select>
        </div>
      )}

      <div className={funnelStyles.summaryRow}>
        {KIND_ORDER.map((kind) => (
          <div key={kind} className={funnelStyles.summaryItem}>
            <span className={funnelStyles.summaryValue}>{data?.by_kind?.[kind] ?? 0}</span>
            <span className={funnelStyles.summaryLabel}>{KIND_LABEL[kind]}</span>
          </div>
        ))}
      </div>

      <Input
        placeholder="Поиск по имени, @username или тексту анкеты"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className={funnelStyles.board}>
        {STAGES.map((stage) => {
          const stageItems = filtered.filter((item) => item.status === stage.status)
          const stageHasPlan = stageItems.some((item) => item.plan_id != null)
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
                  groupByPlan(stageItems, plans, (item) => ({
                    id: item.plan_id,
                    name: item.plan_name,
                  })).map((group) => (
                    <div key={group.key} className={funnelStyles.planGroup}>
                      {/* До стадии «Выбирает тариф» тарифа ещё нет ни у кого — в таких
                          колонках подзаголовок «Без тарифа» только шумел бы. */}
                      {stageHasPlan && (
                        <div className={funnelStyles.planGroupHead}>
                          <span className={funnelStyles.planGroupTitle}>{group.label}</span>
                          <span className={funnelStyles.planGroupCount}>{group.items.length}</span>
                        </div>
                      )}
                      {group.items.map((item) => (
                        <ApplicationCard key={item.id} item={item} onOpen={() => setOpenId(item.id)} />
                      ))}
                    </div>
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
