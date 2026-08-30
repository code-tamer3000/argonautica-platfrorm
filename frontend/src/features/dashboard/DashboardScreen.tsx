import { differenceInCalendarDays, format } from 'date-fns'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard } from '../../api/dashboard'
import { useExpeditionLocks } from '../../api/expedition'
import { useRooms } from '../../api/rooms'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'
import type { Element } from '../../lib/types'
import { plural } from '../../lib/format'
import { ExpeditionWheel } from './ExpeditionWheel'
import { LockDialog } from './LockDialog'
import { ELEMENT_ORDER, elementName, stageName } from './wheelGeometry'
import styles from './dashboard.module.css'

const fmtShort = (iso: string) => format(new Date(iso), 'dd.MM')
const fmtTime = (iso: string) => format(new Date(iso), 'HH:mm')

export function DashboardScreen() {
  const { user } = useAuth()
  const { data, isLoading } = useDashboard()
  const { data: locks } = useExpeditionLocks()
  const { data: rooms } = useRooms()
  const [activeLock, setActiveLock] = useState<Element | null>(null)

  const myDiaryRoomId = useMemo(
    () => rooms?.find((r) => r.is_personal && r.created_by === user?.id)?.id,
    [rooms, user?.id],
  )

  const beforeStart =
    user?.intake_starts_on != null
      ? Math.max(0, differenceInCalendarDays(new Date(user.intake_starts_on), new Date()))
      : 0
  const isPending = beforeStart > 0

  if (isLoading || !data) {
    return (
      <div className="center grow">
        <Spinner />
      </div>
    )
  }

  const { expedition } = data
  const today = expedition?.today ?? null
  const currentStage =
    today != null ? expedition!.stages.find((s) => today >= s.day_from && today <= s.day_to) : undefined

  const tagline = isPending
    ? `До старта осталось ${beforeStart} ${plural(beforeStart, ['день', 'дня', 'дней'])}`
    : expedition == null
      ? 'Ваш путь ещё не начался'
      : currentStage
        ? `День ${today} · ${stageName(currentStage.kind)}`
        : 'Экспедиция пройдена'

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1>Экспедиция</h1>
        <div className={styles.headSub}>{tagline}</div>
      </div>

      <div className={styles.grid}>
        <section className={styles.circleCol} aria-label="Круг экспедиции">
          <div className={styles.stage}>
            {expedition ? (
              <ExpeditionWheel expedition={expedition} onLockClick={setActiveLock} />
            ) : (
              <EmptyState size="block">Расписание Круга ещё не заведено.</EmptyState>
            )}
          </div>
          {expedition && (
            <div className={styles.legend}>
              {ELEMENT_ORDER.map((element) => (
                <span key={element} className={styles.legendItem}>
                  <i className={styles.legendSwatch} style={{ background: `var(--el-${element})` }} />
                  {elementName(element)}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className={styles.rail} aria-label="Что сейчас">
          {!isPending && data.journal && (
            <Card className={styles.today} accent>
              <div className={styles.cardHead}>
                <h3>Сегодня</h3>
              </div>
              {today != null && expedition && (
                <div className={styles.todayRow}>
                  <span className={styles.dayNo}>{today}</span>
                  <span className={styles.dayOf}>день из {expedition.total_days}</span>
                </div>
              )}
              {data.journal.sections.length > 0 && (
                <div className={styles.sections}>
                  {data.journal.sections.map((s) => (
                    <span
                      key={s.key}
                      className={data.journal_today_done ? `${styles.section} ${styles.sectionDone}` : styles.section}
                    >
                      {s.emoji} {s.label}
                    </span>
                  ))}
                </div>
              )}
              {data.journal_locked && (
                <p className={styles.headSub}>Дневник закрыт вместе с окном набора.</p>
              )}
              {!data.journal_locked && myDiaryRoomId != null && (
                <Link to={`/diaries/${myDiaryRoomId}`} className="btn btn-gold">
                  {data.journal_today_done ? 'День закрыт · открыть дневник' : 'Заполнить дневник за сегодня'}
                </Link>
              )}
            </Card>
          )}

          {data.news_preview && (
            <Card>
              <div className={styles.cardHead}>
                <h3>Новости</h3>
                <span className={styles.cardHeadSpacer} />
                <Link to="/news" className={styles.cardMore}>
                  Все новости
                </Link>
              </div>
              <div className={styles.newsAuthor}>
                <span className={styles.newsAuthorName}>{data.news_preview.author_name}</span>
                <span className={styles.newsDate}>{fmtShort(data.news_preview.created_at)}</span>
              </div>
              <p className={styles.newsBody}>{data.news_preview.preview}</p>
            </Card>
          )}

          {data.upcoming_events.length > 0 && (
            <Card>
              <div className={styles.cardHead}>
                <h3>Ближайшее</h3>
                <span className={styles.cardHeadSpacer} />
                <Link to="/calendar" className={styles.cardMore}>
                  Календарь
                </Link>
              </div>
              <div className={styles.list}>
                {data.upcoming_events.map((e) => (
                  <div key={e.id} className={styles.item}>
                    <span className={styles.itemWhen}>{fmtShort(e.starts_at)}</span>
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>{e.title}</span>
                      {e.description && <span className={styles.itemMeta}>{e.description}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {!user || user.role !== 'admin' ? (
            <Card>
              <div className={styles.cardHead}>
                <h3>Активные задания</h3>
                <span className={styles.cardHeadSpacer} />
                <Link to="/tasks" className={styles.cardMore}>
                  Все задачи
                </Link>
              </div>
              {data.active_tasks.length === 0 ? (
                <EmptyState size="inline">Активных заданий нет.</EmptyState>
              ) : (
                <div className={styles.list}>
                  {data.active_tasks.map((t) => (
                    <Link key={t.id} to={`/tasks/${t.id}`} className={styles.item}>
                      <span className={styles.itemWhen}>
                        {t.deadline_at ? fmtShort(t.deadline_at) : 'без срока'}
                      </span>
                      <span className={styles.itemBody}>
                        <span className={styles.itemTitle}>{t.title}</span>
                        <span className={styles.itemMeta}>
                          {t.my_status === 'returned' ? 'вернули на доработку' : 'не сдано'}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          <Card>
            <div className={styles.cardHead}>
              <h3>Уведомления</h3>
              <span className={styles.cardHeadSpacer} />
              {data.unread_notifications > 0 && (
                <span className={styles.cardMore}>{data.unread_notifications} новых</span>
              )}
            </div>
            {data.notifications.length === 0 ? (
              <EmptyState size="inline">Уведомлений пока нет.</EmptyState>
            ) : (
              <div className={styles.list}>
                {data.notifications.map((n) => (
                  <div key={n.id} className={styles.item}>
                    <span className={styles.itemWhen}>{fmtTime(n.created_at)}</span>
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>{n.preview ?? n.title ?? 'Уведомление'}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      </div>

      {activeLock && expedition && (
        <LockDialog
          element={activeLock}
          state={expedition.lock_states[activeLock]}
          lock={locks?.find((l) => l.element === activeLock)}
          onClose={() => setActiveLock(null)}
        />
      )}
    </div>
  )
}
