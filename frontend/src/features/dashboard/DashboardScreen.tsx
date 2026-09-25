import { differenceInCalendarDays, format } from 'date-fns'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard } from '../../api/dashboard'
import { useMyDynamics } from '../../api/dynamics'
import { useExpeditionLocks } from '../../api/expedition'
import { useRooms } from '../../api/rooms'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { IconFlame } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { useIsOfflineEmpty } from '../../hooks/useOfflineEmpty'
import { useAuth } from '../auth/AuthContext'
import type { Element } from '../../lib/types'
import { plural } from '../../lib/format'
import { ExpeditionWheel } from './ExpeditionWheel'
import { LockDialog } from './LockDialog'
import { TasksCard } from './TasksCard'
import { stageName } from './wheelGeometry'
import styles from './dashboard.module.css'

const fmtShort = (iso: string) => format(new Date(iso), 'dd.MM')
const fmtTime = (iso: string) => format(new Date(iso), 'HH:mm')

export function DashboardScreen() {
  const { user } = useAuth()
  const { data, isLoading, isError, dataUpdatedAt } = useDashboard()
  const { data: locks } = useExpeditionLocks()
  const { data: rooms } = useRooms()
  const [activeLock, setActiveLock] = useState<Element | null>(null)

  // Пока активное задание ведёт отписки в группу (journal.chat_room_id),
  // виджет должен открывать её, а не личный дневник — иначе кнопка «заполнить»
  // ведёт не в ту комнату, где на самом деле показан виджет отписок (см.
  // docs/DYNAMICS.md «Целевая комната задания»). Сегмент адреса зависит от
  // типа комнаты: канал (личный дневник) живёт в /diaries, группа — в /chats
  // (см. useOpenRoom.ts).
  const myDiaryRoomId = useMemo(
    () => rooms?.find((r) => r.is_personal && r.created_by === user?.id)?.id,
    [rooms, user?.id],
  )
  const journalTargetRoomId = data?.journal?.chat_room_id ?? myDiaryRoomId
  const journalTargetSegment = useMemo(
    () => (rooms?.find((r) => r.id === journalTargetRoomId)?.type === 'channel' ? 'diaries' : 'chats'),
    [rooms, journalTargetRoomId],
  )

  const beforeStart =
    user?.intake_starts_on != null
      ? Math.max(0, differenceInCalendarDays(new Date(user.intake_starts_on), new Date()))
      : 0
  const isPending = beforeStart > 0

  // Та же видимость, что у блока Динамики в профиле (см. ProfileScreen): выпускнику
  // и держателю самого дешёвого тарифа считать уже/ещё нечего, админ Динамику не ведёт.
  const showDynamicsStats =
    !isPending && !!user && user.role !== 'admin' && !user.graduated_at && !user.is_cheap_tariff
  const { data: dyn } = useMyDynamics({ enabled: showDynamicsStats })

  const tasksEmpty = (data?.active_tasks.length ?? 0) === 0
  const tasksOfflineEmpty = useIsOfflineEmpty({ isLoading, isError, dataUpdatedAt, isEmpty: tasksEmpty })
  const notificationsEmpty = (data?.notifications.length ?? 0) === 0
  const notificationsOfflineEmpty = useIsOfflineEmpty({
    isLoading,
    isError,
    dataUpdatedAt,
    isEmpty: notificationsEmpty,
  })

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
              {!data.journal_locked && journalTargetRoomId != null && (
                <Link to={`/${journalTargetSegment}/${journalTargetRoomId}`} className="btn btn-gold">
                  {data.journal_today_done ? 'День закрыт · открыть дневник' : 'Заполнить дневник за сегодня'}
                </Link>
              )}
              {/* Мини-статистика Динамики: раньше это видели только те, кто зашёл
                  в профиль — а туда почти никто не заходит (ARG-126). */}
              {showDynamicsStats && dyn && (
                <div className={styles.miniStats}>
                  <div className={styles.miniStat}>
                    <IconFlame size={16} className={styles.miniStatIcon} />
                    <span className={styles.miniStatValue}>{dyn.streak}</span>
                    <span className={styles.miniStatLabel}>{plural(dyn.streak, ['день', 'дня', 'дней'])} подряд</span>
                  </div>
                  <div className={styles.miniStat}>
                    <span className={styles.miniStatValue}>{dyn.closed_count} из 28</span>
                    <span className={styles.miniStatLabel}>дней закрыто</span>
                  </div>
                  <Link to="/profile" className={styles.miniStatsLink}>
                    Смотреть полную статистику
                  </Link>
                </div>
              )}
            </Card>
          )}

          {(!user || user.role !== 'admin') && (
            <TasksCard
              activeTasks={data.active_tasks}
              progress={data.tasks_progress}
              inReview={data.tasks_in_review}
              offlineEmpty={tasksOfflineEmpty}
            />
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
                    <span className={styles.itemWhen}>
                      <span>{fmtShort(e.starts_at)}</span>
                      <span className={styles.itemWhenTime}>{fmtTime(e.starts_at)}</span>
                    </span>
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>{e.title}</span>
                      {e.description && <span className={styles.itemMeta}>{e.description}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className={styles.cardHead}>
              <h3>Уведомления</h3>
              <span className={styles.cardHeadSpacer} />
              {data.unread_notifications > 0 && (
                <span className={styles.cardMore}>{data.unread_notifications} новых</span>
              )}
            </div>
            {notificationsEmpty ? (
              <EmptyState size="inline">
                {notificationsOfflineEmpty ? 'Нет сети — не можем загрузить уведомления.' : 'Уведомлений пока нет.'}
              </EmptyState>
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
          isAdmin={user?.role === 'admin'}
        />
      )}
    </div>
  )
}
