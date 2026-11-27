// 位置连续性检测：车辆每步位移不得超过「速度上限 × 步长」的 2.5 倍，
// 超过即判定为瞬移（历史 bug：任务结束清空路径后从初始节点重新规划，车辆跳回原位）。
import { generateMap } from '../src/core/gen.js'
import { SimEngine } from '../src/core/engine.js'
import { UNITS_PER_KM } from '../src/data/config.js'

const SPEED_UNITS_PER_MIN = 0.5 * UNITS_PER_KM
const DT = 0.25
const LIMIT = SPEED_UNITS_PER_MIN * DT * 2.5

const map = generateMap({ seed: 20261101, size: 'standard' })
const eng = new SimEngine({ map, vehicleCount: 12, demandPerMin: 1.2, seed: 9 })

const jumps = []
const steps = Math.round(120 / DT)
for (let i = 0; i < steps; i++) {
  // 车队会随阈值增派 / 空驶减派而增减，按车辆 id 对齐，新增车辆跳过当步比对
  const before = new Map(eng.vehicles.map((v) => [v.id, { x: v.x, y: v.y }]))
  eng.step(DT)
  for (const v of eng.vehicles) {
    const b = before.get(v.id)
    if (!b) continue
    const d = Math.hypot(v.x - b.x, v.y - b.y)
    if (d > LIMIT) jumps.push({ id: v.id, d: +d.toFixed(1), t: +eng.time.toFixed(1), state: v.state })
  }
}

const met = eng.metrics()
console.log(`仿真 120 分钟 / ${eng.vehicles.length} 辆车 / 步长 ${DT} 分`)
console.log(`单步位移上限 ${LIMIT.toFixed(1)} 单位（速度 ${SPEED_UNITS_PER_MIN} 单位/分）`)
console.log(`呼叫 ${met.calls} · 匹配率 ${(met.matchRate * 100).toFixed(1)}% · 平均等待 ${met.avgWaitMin.toFixed(2)} 分`)
console.log(`瞬移次数: ${jumps.length}`)
if (jumps.length) {
  console.log('前 10 次:', JSON.stringify(jumps.slice(0, 10)))
  process.exit(1)
}

// 额外验证：车辆位置必须始终落在某条路段上（点到线段距离≈0）
function distToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// 真实道路是折线（高德路径），判据须用折线而非节点连线
const offRoad = eng.vehicles.map((v) => {
  let best = Infinity
  for (const e of map.edges) {
    const pts = e.pts
    for (let i = 0; i < pts.length - 1; i++) {
      best = Math.min(best, distToSegment(v, { x: pts[i][0], y: pts[i][1] }, { x: pts[i + 1][0], y: pts[i + 1][1] }))
    }
  }
  return { id: v.id, off: +best.toFixed(2) }
})
const maxOff = Math.max(...offRoad.map((r) => r.off))
console.log(`车辆偏离路段最大距离: ${maxOff.toFixed(2)} 单位`)
if (maxOff > 0.5) {
  console.log('✗ 车辆脱离路网:', JSON.stringify(offRoad.filter((r) => r.off > 0.5)))
  process.exit(1)
}
console.log('✓ 无瞬移、车辆始终在路上')
