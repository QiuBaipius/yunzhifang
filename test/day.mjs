// 全日仿真、需求模型、阈值增派、成本与回放回归测试
import { generateMap } from '../src/core/gen.js'
import { SimEngine } from '../src/core/engine.js'
import { DemandModel, classifyStop } from '../src/core/demand.js'
import { vehicleDailyCost, costPerKm, fixedCostDaily } from '../src/core/cost.js'
import { DEMAND, DISPATCH } from '../src/data/config.js'

let fail = 0
const ok = (cond, msg) => { console.log((cond ? '✓' : '✗') + ' ' + msg); if (!cond) fail++ }

// 用完整规模（全部真实站台），保证「育明高中」等特征站点一定在样本里
const map = generateMap({ seed: 20261022, size: 'large' })
// 站台模型下一个站名会有「路北 / 路南」两个站台，按原始站名索引到其中之一即可
const byName = new Map(map.stops.map((s) => [s.rawName || s.name, s]))

// 1. 用地类型自动识别
const cases = [
  ['育明高中', 'highschool'],
  ['七院', 'hospital'],
  ['万达广场', 'mall'],
  ['软件园', 'office'],
  ['海事大学', 'metro'],
  ['凌水路', 'residential'],
]
const wrong = cases.filter(([name, cat]) => {
  const s = byName.get(name) || { name, metro: name === '海事大学' }
  return classifyStop(s).category !== cat
})
ok(wrong.length === 0, `用地类型自动识别正确（错判 ${wrong.map((w) => w[0]).join('、') || '0'} 个）`)
ok(map.stops.every((s) => !!classifyStop(s).category), '地图内每个站点都能匹配到用地类型')

// 2. 需求曲线随时段变化：高中 21:10 > 中午
const demand = new DemandModel({ stops: map.stops })
const hs = byName.get('育明高中')
const r21 = demand.rateOf(hs.id, 21 * 60 + 10)
const r12 = demand.rateOf(hs.id, 12 * 60)
const r9 = demand.rateOf(hs.id, 9 * 60)
ok(r21 > r12 * 2 && r21 > r9, `高中站点 21:10 需求 ${r21.toFixed(3)} > 12:00 的 ${r12.toFixed(3)} 与 09:00 的 ${r9.toFixed(3)} 单/分`)
ok(demand.rateOf(hs.id, 3 * 60) === 0 && demand.rateOf(hs.id, 24 * 60) === 0, '运营窗口（05:30–23:45）之外需求为 0')
ok(map.stops.every((s) => demand.rateOf(s.id, 8 * 60) >= 0), '全部站点在早高峰都有非负需求强度')

// 3. 车场节点与出入场道路（X1 凌水客运站 / X2 和光大厦）
ok(map.depots?.length === 2, `两条线路各有车场（${map.depots.map((d) => `${d.lineId} ${d.name}`).join(' / ')}）`)
ok(map.depots.every((d) => map.nodeMap.has(d.nodeId)), '车场节点都吸附在路网上')
const depotLinks = map.depots.map((d) => map.adj[d.nodeId].filter((e) => map.edgeMap.has(d.nodeId + '|' + e.to)))
ok(
  depotLinks.every((l) => l.length === 1),
  `每个车场与最近的道路节点双向连通（${depotLinks.reduce((s, l) => s + l.length, 0)} 条出入段）`,
)
ok(
  map.depots.every((d) => map.stops.every((s) => Number.isFinite(map.distKm(d.nodeId, s.nodeId)))),
  '每个车场到所有站点均可达',
)
ok(
  map.stops.every((s) => map.stops.every((t) => Number.isFinite(map.distKm(s.nodeId, t.nodeId)))),
  '任意两个站台之间都有一条沿真实道路的路径',
)

// 4. 成本模型：里程是唯一变量
const f = fixedCostDaily()
const c0 = vehicleDailyCost({ km: 0 })
const c200 = vehicleDailyCost({ km: 200 })
ok(Math.abs(c0.total - f.total) < 1e-6, `零公里日成本 = 固定成本 ${f.total.toFixed(1)} 元`)
ok(Math.abs(c200.total - c0.total - 200 * costPerKm().total) < 1e-6, `每公里边际成本 ${costPerKm().total.toFixed(3)} 元/km 线性累加`)
ok(c200.perKm > 0 && c200.perOrder === null, '车公里成本 / 单均成本计算正确（无订单时单均为空）')

// 5. 全日仿真：05:30 — 23:45
const eng = new SimEngine({
  map,
  vehicleCounts: { X1: 8, X2: 4 },
  demand,
  seed: 7,
  startAtDepot: true,
  record: true,
  sampleEvery: 1,
  thresholdMin: DISPATCH.addVehicleEtaMin,
})
const t0 = Date.now()
const summary = eng.runDay(0.5)
const ms = Date.now() - t0

ok(Math.abs(eng.time - DEMAND.windowEnd) < 1e-6, `仿真停在 ${(eng.time / 60).toFixed(2)} 点（23:45）`)
ok(eng.orders.length > 300, `全日呼叫 ${eng.orders.length} 单`)
ok(summary.rows.length >= 12, `成本表覆盖 ${summary.rows.length} 辆车（含中途增派）`)
ok(summary.rows.every((r) => r.cost.total > 0 && r.cost.total === r.cost.fixed + r.cost.variable), '每辆车都有正的日成本，且 = 固定 + 里程')
ok(summary.rows.every((r) => r.km >= 0), '里程非负')
ok(summary.totals.cost > 0 && summary.totals.perKm > 0, `车队总成本 ${summary.totals.cost.toFixed(0)} 元，车公里成本 ${summary.totals.perKm.toFixed(2)} 元/km`)
ok(summary.totals.vehicles === summary.rows.length, '车队合计与明细行数一致')
ok(summary.rows.some((r) => r.added), '存在从车场增派的车辆')
ok(
  eng.vehicles.every((v) => (v.lineId === 'X1' ? v.areaId === 'a1' : v.areaId === 'a2')),
  '车辆按线路归属各自运营区（X1→a1 / X2→a2）',
)
ok(eng.fleetEvents.some((e) => e.kind === 'retire'), '存在空驶超时减派回场的车辆')
ok(eng.orders.every((o) => o.status === 'rejected' || o.vehicleId), '所有成交订单都有归属车辆')
ok(eng.orders.some((o) => o.dispatchMode === 'depot'), '存在「匹配车 ETA 超阈值 → 车场增派新车」的订单')
const depotOrders = eng.orders.filter((o) => o.dispatchMode === 'depot')
ok(
  depotOrders.every((o) => o.etaOriginal == null || o.etaNew < o.etaOriginal),
  '阈值增派单均满足「新车 ETA < 原匹配车 ETA」（原先无车可派时也直接出车）',
)
ok(eng.orders.some((o) => o.flags.some((x) => x.kind === 'far')), '存在「接单距离远」标记的订单')

// 6. 拼车一致性：每个接单中的订单只属于一辆车，且一定在该车的服务序列里
const eng3 = new SimEngine({
  map,
  vehicleCount: 10,
  demand,
  seed: 31,
  startAtDepot: true,
  thresholdMin: DISPATCH.addVehicleEtaMin,
})
let pooled = 0
let maxOnboard = 0
let mismatch = 0
for (let i = 0; i < 240; i++) {
  eng3.step(0.5)
  for (const v of eng3.vehicles) maxOnboard = Math.max(maxOnboard, v.onboard)
  for (const o of eng3.orders) {
    if (o.status !== 'assigned' && o.status !== 'onboard') continue
    const owners = eng3.vehicles.filter(
      (v) => v.plan.some((e) => e.orderId === o.id) || v.riders.some((r) => r.orderId === o.id),
    )
    if (owners.length !== 1) mismatch++
    if (o.status === 'assigned' && owners[0]?.riders.length > 0) pooled++
  }
}
ok(maxOnboard >= 2, `存在拼车（单车最多同时载 ${maxOnboard} 人）`)
ok(pooled > 0, `存在「车上已有乘客时再接新单」的插入（采样 ${pooled} 次）`)
ok(mismatch === 0, `每单只属于一辆车且在其服务序列中（异常 ${mismatch}）`)

// 7. 需求预测引导：早高峰空闲车被分配到多个「供小于需」站点，且不会全部扎堆同一站
const eng2 = new SimEngine({ map, vehicleCount: 12, demand, seed: 21, startAtDepot: true })
let bestSpread = { size: 0, at: 0, max: 0, bad: 0, targets: [] }
while (eng2.time < 12 * 60) {
  eng2.step(0.5)
  if (Math.abs(eng2.time % 10) > 1e-6) continue
  const idle = eng2.vehicles.filter((v) => v.status === 'idle' && !v.riders.length)
  const targets = idle.filter((v) => v.rebalanceTarget).map((v) => v.rebalanceTarget)
  const per = new Map()
  for (const t of targets) per.set(t, (per.get(t) || 0) + 1)
  const max = Math.max(0, ...per.values())
  if (per.size > bestSpread.size) {
    bestSpread = {
      size: per.size,
      at: eng2.time,
      max,
      bad: [...per.keys()].filter((id) => demand.expectedCalls(id, eng2.time, 15) <= 0).length,
      targets: [...per.keys()],
    }
  } else if (per.size === bestSpread.size && max > bestSpread.max) {
    bestSpread.max = max
  }
}
ok(bestSpread.size >= 2, `空闲车目标分散在 ${bestSpread.size} 个站点（${(bestSpread.at / 60).toFixed(1)} 点，最大扎堆 ${bestSpread.max} 辆）`)
ok(bestSpread.max <= 5, `单站引导上限受控（最多 ${bestSpread.max} 辆）`)
ok(bestSpread.bad === 0, '引导目标都是未来 15 分钟有需求的站点')

// 8. 轨迹记录与回放插值
const demo = summary.rows.reduce((a, b) => (a.km >= b.km ? a : b))
const track = eng.trackOf(demo.vehicleId)
ok(track.length > 600, `轨迹采样 ${track.length} 个点（${demo.plate}，1 分钟/点）`)
const mid = eng.positionAt(demo.vehicleId, DEMAND.windowStart + 300)
ok(mid && isFinite(mid.x) && isFinite(mid.y), '回放插值返回有效坐标')
const journal = summary.journalByVehicle[demo.vehicleId]
ok(Array.isArray(journal) && journal.every((j) => j.t >= DEMAND.windowStart && j.t <= DEMAND.windowEnd), '接单流水时间都落在运营窗口内')

console.log(`\n全日仿真耗时 ${ms} ms · 订单 ${eng.orders.length} · 匹配率 ${(eng.metrics().matchRate * 100).toFixed(1)}% · 平均等待 ${eng.metrics().avgWaitMin.toFixed(2)} 分`)
console.log('成本最低/最高车辆:')
const sorted = [...summary.rows].sort((a, b) => a.cost.total - b.cost.total)
for (const r of [sorted[0], sorted[sorted.length - 1]]) {
  console.log(`  ${r.plate}${r.added ? '（增派）' : ''}  里程 ${r.km.toFixed(0)} km  订单 ${r.orders}  日成本 ¥${r.cost.total.toFixed(0)}  单均 ¥${(r.perOrderCost || 0).toFixed(1)}`)
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
