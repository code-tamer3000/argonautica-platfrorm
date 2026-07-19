import { useMemo } from 'react'
import type { StreamNodeOut } from '../../../api/tasks'
import { useUsersMap } from '../../../api/users'
import { layoutBracket, LEAF_W, NODE_H, NODE_W } from './geometry'
import styles from './stream.module.css'

/**
 * Турнирная сетка потока: участники по краям, узлы сходятся к корню в центре.
 *
 * Компонент без состояния — что подсвечено и что выбрано, решает родитель
 * (паттерн features/genkeys/GeneKeysWheel.tsx). Фразы приходят уже отфильтрованными
 * сервером: `phrase === null` значит «ещё не открыта», а не «её нет».
 */
export function StreamBracket({
  nodes,
  depth,
  activeRound,
  selectedUserId,
  selectedNodeId,
  onSelectUser,
  onSelectNode,
}: {
  nodes: StreamNodeOut[]
  depth: number
  activeRound: number | null
  selectedUserId: number | null
  selectedNodeId: number | null
  onSelectUser: (userId: number) => void
  onSelectNode: (nodeId: number) => void
}) {
  const users = useUsersMap()
  const bracket = useMemo(() => layoutBracket(nodes, depth), [nodes, depth])

  const name = (userId: number) => users.get(userId)?.display_name ?? `#${userId}`

  return (
    <div className={styles.canvasScroll}>
      <svg
        className={styles.canvas}
        viewBox={`0 0 ${bracket.width} ${bracket.height}`}
        width={bracket.width}
        height={bracket.height}
        role="group"
        aria-label="Сетка потока"
      >
        <g className={styles.links}>
          {bracket.links.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {bracket.leaves.map((leaf) => {
          const selected = leaf.userId === selectedUserId
          return (
            <g
              key={`leaf-${leaf.userId}`}
              className={selected ? `${styles.leaf} ${styles.selected}` : styles.leaf}
              onClick={() => onSelectUser(leaf.userId)}
              role="button"
              tabIndex={0}
              aria-label={`Тексты участника ${name(leaf.userId)}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectUser(leaf.userId)
              }}
            >
              <rect
                x={leaf.x - LEAF_W / 2}
                y={leaf.y - NODE_H / 2}
                width={LEAF_W}
                height={NODE_H}
                rx={8}
              />
              <text x={leaf.x} y={leaf.y + 4} textAnchor="middle">
                {name(leaf.userId)}
              </text>
            </g>
          )
        })}

        {nodes.map((node) => {
          const box = bracket.nodes.get(node.id)
          if (!box) return null
          const classes = [styles.node]
          if (node.id === selectedNodeId) classes.push(styles.selected)
          if (node.is_mine) classes.push(styles.mine)
          if (node.approved) classes.push(styles.approved)
          if (activeRound === node.round) classes.push(styles.active)
          return (
            <g
              key={node.id}
              className={classes.join(' ')}
              onClick={() => onSelectNode(node.id)}
              role="button"
              tabIndex={0}
              aria-label={`${node.label}${node.phrase ? `: ${node.phrase}` : ''}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectNode(node.id)
              }}
            >
              <rect
                x={box.x - NODE_W / 2}
                y={box.y - NODE_H / 2}
                width={NODE_W}
                height={NODE_H}
                rx={8}
              />
              {node.phrase ? (
                <text x={box.x} y={box.y + 4} textAnchor="middle">
                  <title>{node.phrase}</title>
                  {truncate(node.phrase, 18)}
                </text>
              ) : (
                <text x={box.x} y={box.y + 4} textAnchor="middle" className={styles.muted}>
                  {node.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
