// 独立工程引擎冒烟测试：Node 直接运行
// 注意：本组用例关闭「自动增派」，检验的是固定车队下拼车算法本身的表现。
import { generateMap } from '../src/core/gen.js'
import { SimEngine } from '../src/core/engine.js'

let fail = 0
const ok = (cond, msg) => { console.log((cond ? '✓' : '✗') + ' ' + msg); if (!cond) fail++ }

// 1. 地图生成可复现
const m1 = generateMap({ seed: 42, size: 'standard' })
const m2 = generateMap({ seed: 42, size: 'standard' })
ok(m1.stops.length === m2.stops.length && m1.edges.length === m2.edges.length, '同种子地图可复现')
ok(m1.stops.every((s) => s.type === 'both'), '全部站点均为可乘降点（不再有仅下车点）')
ok(m1.lines.length >= 2 && m1.lines.length <= 4, '线路 2-4 条')
ok(m1.stops.every((s) => m1.nodeMap.has(s.nodeId)), '所有站点位于路网节点上')

// 2. 引擎运行 90 分钟（6 辆 / 1.2 单每分：需求超过运力，匹配率天然偏低）
const eng = new SimEngine({ map: m1, vehicleCount: 6, demandPerMin: 1.2, seed: 7, autoFleet: false })
const met = eng.run(90, 0.5)
ok(met.calls > 30, `呼叫数 ${met.calls} > 30`)
ok(met.matchRate > 0.05 && met.matchRate < 0.99, `匹配率 ${(met.matchRate * 100).toFixed(1)}% 在合理区间（运力不足时如实偏低）`)
ok(met.avgWaitMin > 0 && met.avgWaitMin < 30, `平均等待 ${met.avgWaitMin.toFixed(2)} 分钟合理`)
ok(met.unreasonable >= 0, `疑似不合理单 ${met.unreasonable}`)

// 3. 拼车正确性：同车多人、每单只属于一辆车、assigned 单必在其车辆的服务序列里
const eng2 = new SimEngine({ map: m1, vehicleCount: 4, demandPerMin: 3, seed: 11, autoFleet: false })
let maxOnboard = 0
let violations = 0
let doubleAssign = 0
let pooledOrders = 0
for (let i = 0; i < 90 * 4; i++) {
  eng2.step(0.25)
  for (const v of eng2.vehicles) maxOnboard = Math.max(maxOnboard, v.onboard)
  if (i % 20 === 0) {
    for (const o of eng2.orders) {
      if (o.status !== 'assigned' && o.status !== 'onboard') continue
      const owners = eng2.vehicles.filter(
        (v) => v.plan.some((e) => e.orderId === o.id) || v.riders.some((r) => r.orderId === o.id),
      )
      if (owners.length !== 1) violations++
      if (owners.length > 1) doubleAssign++
      if (owners[0] && o.status === 'assigned' && owners[0].riders.length >= 1) pooledOrders++
    }
  }
}
ok(maxOnboard >= 2, `存在拼车（单车同时载客最多 ${maxOnboard} 人）`)
ok(pooledOrders > 0, `存在「车上已有乘客时再接新单」的拼车事件（${pooledOrders} 次采样）`)
ok(violations === 0, `所有接单中的订单都恰好属于一辆车，且在该车服务序列中（异常 ${violations}）`)
ok(doubleAssign === 0, `同一订单不会被两辆车同时承接（冲突 ${doubleAssign}）`)

// 4. 宏观扫描：幂律拟合（高需求 1.2/分：等待随运力单调下降；低需求 0.5/分：应存在最优点）
const rows = []
for (const n of [2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32]) {
  const e = new SimEngine({ map: m1, vehicleCount: n, demandPerMin: 1.2, seed: 100 + n, autoFleet: false })
  rows.push({ n, ...e.run(90, 0.5) })
}
const pts = rows.filter((r) => r.avgWaitMin > 0.01).map((r) => ({ x: Math.log(r.n), y: Math.log(r.avgWaitMin) }))
const k = pts.length
const sx = pts.reduce((s, p) => s + p.x, 0), sy = pts.reduce((s, p) => s + p.y, 0)
const sxx = pts.reduce((s, p) => s + p.x * p.x, 0), sxy = pts.reduce((s, p) => s + p.x * p.y, 0)
const b = (k * sxy - sx * sy) / (k * sxx - sx * sx)
const a = Math.exp((sy - b * sx) / k)
ok(b < 0 && b > -1.5, `幂律指数 b=${b.toFixed(2)} 为负（等待随运力下降）`)
ok(rows[0].avgWaitMin > rows[rows.length - 1].avgWaitMin, `等待随车辆数下降（${rows[0].avgWaitMin.toFixed(1)} → ${rows[rows.length - 1].avgWaitMin.toFixed(1)} 分钟）`)
ok(rows[rows.length - 1].matchRate > rows[0].matchRate, `匹配率随车辆数上升（${(rows[0].matchRate * 100).toFixed(0)}% → ${(rows[rows.length - 1].matchRate * 100).toFixed(0)}%）`)
// 低需求下应存在「等待≤6min 且匹配率≥98%」的最优点
const rows2 = []
for (const n of [2, 4, 6, 8, 10, 12, 16, 20]) {
  const e = new SimEngine({ map: m1, vehicleCount: n, demandPerMin: 0.5, seed: 200 + n, autoFleet: false })
  rows2.push({ n, ...e.run(90, 0.5) })
}
const opt = rows2.find((r) => r.avgWaitMin <= 6 && r.matchRate >= 0.98)
ok(opt !== undefined, `低需求(0.5/分)存在最优点 N=${opt?.n}（等待 ${opt?.avgWaitMin.toFixed(2)}min）`)

console.log('\n等待-运力曲线:')
rows.forEach((r) => console.log(`  N=${String(r.n).padStart(2)}  等待=${r.avgWaitMin.toFixed(2).padStart(5)}min  P90=${r.p90WaitMin.toFixed(1).padStart(5)}min  匹配率=${(r.matchRate * 100).toFixed(1)}%  不合理单=${r.unreasonable}`))
console.log(`\n拟合: W(N) ≈ ${a.toFixed(2)} × N^(${b.toFixed(2)})`)
console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
