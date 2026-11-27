// 拼车核心算法单元测试：可行插入（CFI）+ 逐乘客绕行预算 + 局部重优化
import { generateMap } from '../src/core/gen.js'
import { insertOrder, improvePlan, planKm } from '../src/services/ridepool.js'

let fail = 0
const ok = (cond, msg) => { console.log((cond ? '✓' : '✗') + ' ' + msg); if (!cond) fail++ }

// ---------------- 合成一维路网（便于精确断言） ----------------
const NODES = {
  M10: { id: 'M10', x: -10, nodeId: 'M10', name: 'M10' },
  M5: { id: 'M5', x: -5, nodeId: 'M5', name: 'M5' },
  O: { id: 'O', x: 0, nodeId: 'O', name: 'O' },
  P10: { id: 'P10', x: 10, nodeId: 'P10', name: 'P10' },
  Q20: { id: 'Q20', x: 20, nodeId: 'Q20', name: 'Q20' },
  R30: { id: 'R30', x: 30, nodeId: 'R30', name: 'R30' },
  S100: { id: 'S100', x: 100, nodeId: 'S100', name: 'S100' },
  T150: { id: 'T150', x: 150, nodeId: 'T150', name: 'T150' },
}
const stopOf = (id) => NODES[id]
const kmFn = (a, b) => Math.abs((a.x ?? 0) - (b.x ?? 0))

function vehicle({ at = 'O', riders = [], plan = [], onboard = riders.length, capacity = 17 } = {}) {
  return {
    id: 'V1', plate: '测试车', x: NODES[at].x, y: 0, node: at, path: [], s: 0, km: 0,
    riders, plan, onboard, capacity, seats: 9,
  }
}
function rider(id, fromId, toId, boardKm = 0) {
  return { orderId: id, fromId, toId, boardKm, boardTime: 0 }
}
const order = (id, fromId, toId, directKm) => ({ id, fromId, toId, directKm, odKm: directKm, callTime: 0 })
// 车上乘客各自的 OD 最优路径距离（一维线网 = |x1-x2|）
const directOf = (v) => (oid) => {
  const r = v.riders.find((x) => x.orderId === oid)
  if (!r) return Infinity
  return kmFn(NODES[r.fromId], NODES[r.toId])
}
const ctxOf = (v) => ({
  kmFn, stopOf, capacity: v.capacity, detourRatio: 1 / 3, waitMaxMin: 20,
  speedKmPerMin: 0.5, directKmOf: directOf(v), localSearch: true, localSearchPasses: 2,
})

// 1. 多乘客：第二位乘客预算被击穿时必须拒单（只看首位乘客的旧规则会放行）
{
  // 车在 0 点，R1（长 OD 0→100，预算 133）先上车，R2（短 OD 0→20，预算 26.7）
  const v = vehicle({
    riders: [rider('R1', 'O', 'S100'), rider('R2', 'O', 'Q20')],
    plan: [
      { orderId: 'R2', type: 'dropoff', stopId: 'Q20' },
      { orderId: 'R1', type: 'dropoff', stopId: 'S100' },
    ],
  })
  // 新单在 -10 上车、-5 下车：任何插入都会让某位乘客超预算
  const n = order('N1', 'M10', 'M5', 5)
  const res = insertOrder([v], n, ctxOf(v))
  ok(!res.ok && res.reason === 'detour_budget', `第二位乘客预算击穿 → 拒单（${res.reason}）`)
  ok(
    res.rejected.some((r) => r.reason === 'detour_budget' && r.orderId === 'R2'),
    '拒单明细里包含「短 OD 乘客 R2 超预算」（逐乘客校验生效）',
  )

  // 旧规则（只看首位乘客 R1，OD 100km）的增量：10 + 5 + 105 − 100 = 20 ≤ 33.3，会被放行
  const oldInc = kmFn(v, NODES.M10) + 5 + kmFn(NODES.M5, NODES.S100) - kmFn(v, NODES.S100)
  ok(oldInc <= 100 / 3, `对照：旧「首位乘客」规则增量 ${oldInc.toFixed(0)}km ≤ 33.3km，本会误接`)
}

// 2. 同样插入，但两位乘客的 OD 都足够长 → 可行，且分配到的预算明细覆盖所有乘客
{
  const v = vehicle({
    riders: [rider('R1', 'O', 'T150'), rider('R2', 'O', 'Q20')],
    plan: [
      { orderId: 'R2', type: 'dropoff', stopId: 'Q20' },
      { orderId: 'R1', type: 'dropoff', stopId: 'T150' },
    ],
  })
  const n = order('N2', 'P10', 'R30', 20)
  const res = insertOrder([v], n, ctxOf(v))
  ok(res.ok, '不超预算时正常接单')
  if (res.ok) {
    const ids = res.candidates[0].perRider.map((r) => r.orderId).sort()
    ok(ids.join(',') === 'N2,R1,R2', `预算校验覆盖车上每位乘客与新乘客（${ids.join(',')}）`)
    ok(res.candidates[0].perRider.every((r) => r.plannedKm <= r.budgetKm + 1e-6), '所有乘客的预计乘车里程都在各自预算内')
  }
}

// 3. 容量：满载时不得再接
{
  const v = vehicle({
    capacity: 2,
    riders: [rider('R1', 'O', 'S100'), rider('R2', 'O', 'Q20')],
    plan: [
      { orderId: 'R2', type: 'dropoff', stopId: 'Q20' },
      { orderId: 'R1', type: 'dropoff', stopId: 'S100' },
    ],
  })
  const res = insertOrder([v], order('N3', 'P10', 'R30', 20), ctxOf(v))
  ok(!res.ok, '满载 → 拒单')
  ok(res.rejected.some((r) => r.reason === 'capacity'), '拒单明细包含「容量不足」')
}

// 4. 等待：上车点太远，等不到 20 分钟
{
  const v = vehicle()
  const n = order('N4', 'S100', 'T150', 50) // 100km / 0.5 = 200 分钟
  const res = insertOrder([v], n, ctxOf(v))
  ok(!res.ok && res.reason === 'wait_too_long', `上车点太远 → 拒单（${res.reason}）`)
}

// 5. 插入位次最优：新乘客目的地在下一位乘客之前时不会被排到最后
{
  const v = vehicle({ riders: [rider('R1', 'O', 'S100')], plan: [{ orderId: 'R1', type: 'dropoff', stopId: 'S100' }] })
  const n = order('N5', 'O', 'R30', 30)
  const res = insertOrder([v], n, ctxOf(v))
  ok(res.ok, '顺路单可接')
  if (res.ok) {
    const ev = res.candidates[0].events
    const seq = ev.map((e) => `${e.type === 'pickup' ? '上' : '下'}${e.stopId}`).join('→')
    const total = planKm(v, ev, kmFn, stopOf)
    ok(seq === '上O→下R30→下S100', `插入位次正确（${seq}）`)
    ok(Math.abs(total - 100) < 1e-6 && res.candidates[0].incKm === 0, `插入不增加额外里程（总里程 ${total}km，增量 ${res.candidates[0].incKm}km）`)
  }
}

// 6. 局部重优化：不改变可行性，也不会让总里程变差
{
  const v = vehicle({
    riders: [rider('R1', 'O', 'S100', 0), rider('R2', 'O', 'T150', 0)],
    plan: [
      { orderId: 'R1', type: 'dropoff', stopId: 'S100' },
      { orderId: 'R2', type: 'dropoff', stopId: 'T150' },
    ],
  })
  const n = order('N6', 'P10', 'R30', 20)
  const ctx = ctxOf(v)
  const base = [
    { orderId: 'N6', type: 'pickup', stopId: 'P10' },
    { orderId: 'N6', type: 'dropoff', stopId: 'R30' },
    { orderId: 'R1', type: 'dropoff', stopId: 'S100' },
    { orderId: 'R2', type: 'dropoff', stopId: 'T150' },
  ]
  const imp = improvePlan(v, base, n, ctx)
  ok(imp.eval.ok, '重优化后仍满足全部约束')
  ok(imp.eval.totalKm <= planKm(v, base, kmFn, stopOf) + 1e-6, '重优化不会让总里程变差')
  const seq = imp.events.map((e) => `${e.type === 'pickup' ? '上' : '下'}${e.stopId}`).join('→')
  ok(seq === '上P10→下R30→下S100→下T150', `重优化把新乘客的下车点排到顺路位置（${seq}）`)
}

// ---------------- 真实路网：基准必须是「OD 最优路径」而不是直线 ----------------
const map = generateMap({ seed: 20261022, size: 'large' })
const straight = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / 40
let pair = null
for (const a of map.stops) {
  for (const b of map.stops) {
    if (a.id === b.id) continue
    const r = map.stopRoute(a.id, b.id).km
    const s = straight(a, b)
    if (s > 0.8 && r > s * 1.25) { pair = { a, b, r, s }; break }
  }
  if (pair) break
}
ok(!!pair, '找到一条「路网最短路明显长于直线」的 OD 用于验证')
if (pair) {
  const km2 = (x, y) => {
    const from = x.path !== undefined ? (x.path.length ? x.path[0] : x.node) : x.nodeId
    return map.shortestPath(from, y.nodeId).len / 40
  }
  const v = {
    id: 'VR', plate: '真实路网测试车', x: pair.a.x, y: pair.a.y, node: pair.a.nodeId,
    path: [], s: 0, km: 0, riders: [], plan: [], onboard: 0, capacity: 17, seats: 9,
  }
  const n = order('NR', pair.a.id, pair.b.id, pair.r)
  const res = insertOrder([v], n, {
    kmFn: km2, stopOf: (id) => map.stopById.get(id), capacity: 17, detourRatio: 1 / 3,
    waitMaxMin: 20, speedKmPerMin: 0.5, directKmOf: () => Infinity, localSearch: true,
  })
  ok(res.ok, `真实路网可接单（${pair.a.name}→${pair.b.name}）`)
  if (res.ok) {
    const me = res.candidates[0].perRider.find((r) => r.orderId === 'NR')
    ok(Math.abs(me.directKm - pair.r) < 1e-9, `预算基准 = 路网最短路 ${pair.r.toFixed(2)}km（直线仅 ${pair.s.toFixed(2)}km）`)
    ok(Math.abs(me.budgetKm - pair.r * (4 / 3)) < 1e-9, `预算 = 最短路 × 133% = ${(pair.r * 4 / 3).toFixed(2)}km`)
    ok(me.plannedKm <= me.budgetKm + 1e-6, '空车插入的乘车里程不超过预算')
  }
}

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
