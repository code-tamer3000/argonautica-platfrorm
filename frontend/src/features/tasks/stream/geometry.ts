// Геометрия турнирной сетки потока. Чистые функции; никакого React и DOM —
// по образцу features/genkeys/wheel.ts. Всё считается в единицах viewBox.
//
// Раскладка: участники (листья) стоят по внешним краям, узлы раунда 1 — на колонку
// внутрь, и так до корня в центре. Левое поддерево корня рисуется слева, правое —
// справа, поэтому 16 участников дают ровно 8 слева и 8 справа, сходящихся к центру.
import type { StreamNodeOut } from '../../../api/tasks'

export const LEAF_GAP = 46 // шаг между участниками по вертикали
export const NODE_W = 132
export const NODE_H = 34
export const LEAF_W = 116
export const PAD_Y = 28
export const PAD_X = 16

export interface Placed {
  id: number
  x: number // центр
  y: number
  w: number
  h: number
}

export interface LeafSlot extends Placed {
  userId: number
  side: 'left' | 'right'
}

export interface Bracket {
  width: number
  height: number
  leaves: LeafSlot[]
  nodes: Map<number, Placed>
  /** SVG-пути соединителей: лист→узел раунда 1 и узел→родитель. */
  links: string[]
}

/** Участники стороны в порядке отрисовки сверху вниз. */
function sideLeaves(nodes: StreamNodeOut[], side: 'left' | 'right'): number[] {
  return nodes
    .filter((n) => n.round === 1 && n.side === side)
    .sort((a, b) => a.position - b.position)
    .flatMap((n) => n.member_ids)
}

/**
 * Разложить сетку. `depth` — число раундов слияния (корень имеет round === depth).
 *
 * Узел ставится по вертикали в середину своих участников, поэтому соединители
 * сходятся симметрично независимо от того, ровная сетка или с тройками.
 */
export function layoutBracket(nodes: StreamNodeOut[], depth: number): Bracket {
  const left = sideLeaves(nodes, 'left')
  const right = sideLeaves(nodes, 'right')
  const rows = Math.max(left.length, right.length, 1)

  // Колонок на сторону: листья + раунды 1..depth-1 (корень — общий, в центре).
  const columns = Math.max(depth, 1)
  const colWidth = NODE_W + 56
  const halfWidth = PAD_X + LEAF_W / 2 + colWidth * (columns - 1) + NODE_W / 2
  const width = halfWidth * 2 + NODE_W + 48
  const height = PAD_Y * 2 + rows * LEAF_GAP
  const centerX = width / 2

  const yOf = (index: number, total: number) => {
    // Стороны с разным числом участников центрируем друг относительно друга.
    const offset = (rows - total) / 2
    return PAD_Y + (index + offset + 0.5) * LEAF_GAP
  }

  const leafY = new Map<number, number>()
  const leaves: LeafSlot[] = []
  const place = (ids: number[], side: 'left' | 'right') => {
    ids.forEach((userId, index) => {
      const y = yOf(index, ids.length)
      const x = side === 'left' ? PAD_X + LEAF_W / 2 : width - PAD_X - LEAF_W / 2
      leafY.set(userId, y)
      leaves.push({ id: userId, userId, side, x, y, w: LEAF_W, h: NODE_H })
    })
  }
  place(left, 'left')
  place(right, 'right')

  const columnX = (round: number, side: 'left' | 'right' | null) => {
    if (side === null) return centerX // корень
    const fromEdge = PAD_X + LEAF_W / 2 + colWidth * round
    return side === 'left' ? fromEdge : width - fromEdge
  }

  const placed = new Map<number, Placed>()
  for (const node of nodes) {
    const ys = node.member_ids.map((id) => leafY.get(id)).filter((y): y is number => y != null)
    const y = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : height / 2
    placed.set(node.id, {
      id: node.id,
      x: columnX(node.round, node.side),
      y,
      w: NODE_W,
      h: NODE_H,
    })
  }

  const links: string[] = []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const node of nodes) {
    const self = placed.get(node.id)
    if (!self) continue
    if (node.round === 1) {
      for (const userId of node.member_ids) {
        const leaf = leaves.find((l) => l.userId === userId)
        if (leaf) links.push(connector(leaf, self, node.side ?? 'left'))
      }
    }
    if (node.parent_id != null) {
      const parent = placed.get(node.parent_id)
      const parentNode = byId.get(node.parent_id)
      if (parent && parentNode) {
        links.push(connector(self, parent, node.side ?? 'left'))
      }
    }
  }

  return { width, height, leaves, nodes: placed, links }
}

/** S-образный соединитель от края `from` к краю `to` (кубическая кривая). */
function connector(from: Placed, to: Placed, side: 'left' | 'right'): string {
  const dir = side === 'left' ? 1 : -1
  const x1 = from.x + (from.w / 2) * dir
  const x2 = to.x - (to.w / 2) * dir
  const mid = (x1 + x2) / 2
  return `M ${x1} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${x2} ${to.y}`
}
