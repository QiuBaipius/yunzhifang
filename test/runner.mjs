// 场景层与执行器回归测试：配置读取 / 校验 / 跑场景 / 输出表 / CSV / 摘要
import { runScenario, ordersTable, vehiclesTable, trajectoriesTable, kpisObject, toCsv, summaryText } from '../src/core/runner.js'
import { defaultScenario, readScenario, validateScenario, normalizeStopSettings } from '../src/core/scenario.js'
import { generateMap } from '../src/core/gen.js'
import { CAMPUS_INTERNAL_IDS } from '../src/data/dalian.js'

let fail = 0
const ok = (cond, msg) => { console.log((cond ? '✓' : '✗') + ' ' + msg); if (!cond) fail++ }

// 1. 默认场景可读、可通过校验
const base = defaultScenario()
const c0 = readScenario(base)
ok(c0.fleet.vehicles === 12 && c0.network.size === 'standard', `默认场景：${c0.fleet.vehicles} 辆 / ${c0.network.size} 路网`)
ok(c0.sim.start === 5 * 60 + 30 && c0.sim.end === 23 * 60 + 45, '默认运营窗口 05:30 — 23:45')
ok(validateScenario(base).length === 0, '默认场景通过校验')

// 2. 英文键等价于中文键
const en = readScenario({
  name: 'EN',
  network: { seed: 42, size: 'compact' },
  fleet: { vehicles: 5 },
  dispatch: { thresholdMin: 8, detourRatio: 0.5 },
  sim: { start: '07:00', end: '09:00', seed: 3, stepMin: 0.25 },
})
ok(en.network.seed === 42 && en.fleet.vehicles === 5, '英文键（network / fleet）被正确读取')
ok(en.dispatch.thresholdMin === 8 && en.sim.start === 7 * 60 && en.sim.stepMin === 0.25, '英文键（dispatch / sim）被正确读取')

// 3. 站点覆盖：中文「类型 / 程度」→ DemandModel 的 category / level
const stops = normalizeStopSettings({ b1: { 类型: 'highschool', 程度: 2.5 }, b2: { category: 'mall', level: 1 }, b3: 2, b4: 'metro' })
ok(stops.b1.category === 'highschool' && stops.b1.level === 2.5, '「类型 / 程度」被归一化为 category / level')
ok(stops.b2.category === 'mall' && stops.b2.level === 1, '英文键形式保持可用')
ok(stops.b3.level === 2 && stops.b4.category === 'metro', '纯数字 = 程度，纯字符串 = 类型')

// 4. 校验器拦得住明显错误
const bad = validateScenario(defaultScenario({ 车队: { 初始车辆: 0, 座位数: 9, 容量: 5 }, 仿真: { 开始: '10:00', 结束: '09:00' }, 路网: { 规模: 'huge' } }))
ok(bad.some((e) => e.includes('初始车辆')), '拦截非法初始车辆数')
ok(bad.some((e) => e.includes('容量')), '拦截容量 < 座位数')
ok(bad.some((e) => e.includes('结束时刻')), '拦截结束早于开始')
ok(bad.some((e) => e.includes('路网规模')), '拦截非法路网规模')

// 4.5 路网连通性：任何规模下任意两站都可达（否则距离 Infinity → 派单全量拒单）
for (const size of ['compact', 'standard', 'large']) {
  const m = generateMap({ seed: 42, size })
  const dead = m.stops.filter((a) => m.stops.some((b) => a.id !== b.id && !m.shortestPath(a.nodeId, b.nodeId)))
  ok(dead.length === 0, `${size}：${m.stops.length} 站两两可达（不可达 ${dead.length} 站）`)
  ok(
    m.depots.every((d) => m.stops.every((a) => Number.isFinite(m.distKm(d.nodeId, a.nodeId)))),
    `${size}：两个车场均可达全部站点`,
  )
  ok(
    !m.stops.some((s) => CAMPUS_INTERNAL_IDS.includes(s.id)) &&
      !m.edges.some((e) => CAMPUS_INTERNAL_IDS.includes(e.a) || CAMPUS_INTERNAL_IDS.includes(e.b)),
    `${size}：校内站点与校内道路均被剔除`,
  )
}

// 5. 跑一份两小时的场景（含站点覆盖，验证端到端生效）
// 地图由种子唯一确定，先单独生成一次拿到站点 id，再写进场景的站点覆盖里
const firstId = generateMap({ seed: 20261022, size: 'standard' }).stops[0].id
const scenario = defaultScenario({
  名称: '回归 · 早高峰',
  路网: { 种子: 20261022, 规模: 'standard' },
  需求: { 倍数: 1.5, 站点: { [firstId]: { 类型: 'highschool', 程度: 3 } } },
  车队: { 初始车辆: 10, 自动增派: true },
  仿真: { 开始: '08:00', 结束: '10:00', 步长: 0.5, 随机种子: 11 },
})
const result = runScenario(scenario)
ok(result.engine.time >= 10 * 60 - 1e-6, `仿真停在 ${(result.engine.time / 60).toFixed(2)} 点（10:00）`)
ok(result.kpis.calls === result.engine.orders.length, `呼叫数一致（${result.kpis.calls} 单）`)
ok(result.kpis.calls > 50, '两小时早高峰有足够的呼叫量')
ok(result.summary.totals.vehicles === result.summary.rows.length, '车辆合计与成本明细行数一致')
ok(Array.isArray(result.warnings), '提示信息以数组返回')
ok(result.label.includes('回归 · 早高峰') && result.label.includes('标准'), `场景摘要可读：${result.label}`)
ok(typeof result.elapsedMs === 'number' && result.elapsedMs >= 0, `记录仿真耗时 ${result.elapsedMs} ms`)
ok(result.demand.metaOf(firstId)?.level === 3, '站点程度覆盖生效（DemandModel 读到 level = 3）')

// 6. 可复现：同一场景两次运行结果一致
const again = runScenario(scenario)
ok(again.kpis.calls === result.kpis.calls, '同场景重跑呼叫数一致')
ok(Math.abs(again.summary.totals.km - result.summary.totals.km) < 1e-6, '同场景重跑总里程一致')

// 6.5 精简路网（旧版会抽成不连通碎片）跑一份短场景
const compactRes = runScenario(
  defaultScenario({
    名称: '回归 · 精简路网',
    路网: { 种子: 42, 规模: 'compact' },
    车队: { 初始车辆: 6, 自动增派: false },
    仿真: { 开始: '08:00', 结束: '09:30', 随机种子: 5 },
  }),
)
ok(compactRes.kpis.calls > 0 && compactRes.kpis.matchRate > 0.5, `精简路网 1.5 小时匹配率 ${(compactRes.kpis.matchRate * 100).toFixed(1)}%`)
ok(ordersTable(compactRes).every((r) => r['OD最优路径(km)'] !== 'Infinity'), '订单表没有 Infinity 距离')

// 7. 输出表：列齐全、无 undefined，数量对得上
const orders = ordersTable(result)
const vehicles = vehiclesTable(result)
const tracks = trajectoriesTable(result, 3)
ok(orders.length === result.engine.orders.length, `订单表 ${orders.length} 行`)
ok(vehicles.length === result.summary.rows.length, `车辆表 ${vehicles.length} 行`)
ok(tracks.length > 0 && tracks.length <= Object.values(result.engine.tracks).reduce((s, t) => s + t.length, 0), `轨迹表 ${tracks.length} 行（抽样步长 3）`)
const flat = [...orders, ...vehicles, ...tracks]
ok(flat.every((r) => Object.values(r).every((v) => v !== undefined && !String(v).includes('NaN'))), '输出表没有 undefined / NaN')
ok(orders.every((r) => ['已完成', '在车上', '待上车', '已拒单'].includes(r.状态)), '订单状态文案完整')

// 8. 指标对象与摘要文本
const kpis = kpisObject(result)
ok(kpis.呼叫数 === result.kpis.calls && typeof kpis.匹配率 === 'number', '指标对象包含呼叫数与匹配率')
ok(kpis.总成本元 > 0 && kpis.总里程km > 0, `指标对象包含成本字段（总成本 ¥${kpis.总成本元}）`)
const text = summaryText(result)
ok(text.includes('场景：') && text.includes('匹配率') && text.includes('成本：'), '摘要文本包含场景 / 匹配率 / 成本')

// 9. CSV 转义：逗号、引号、换行都会被正确包裹
const csv = toCsv([{ a: 'x,y', b: 'he said "hi"', c: 'l1\nl2', d: 1 }])
ok(csv.split('\n')[0] === 'a,b,c,d', 'CSV 表头正确')
ok(csv.includes('"x,y"') && csv.includes('"he said ""hi"""'), 'CSV 对逗号与引号做转义')
ok(csv.includes('"l1\nl2"'), 'CSV 对换行做转义')
ok(toCsv([]) === '', '空表返回空字符串')

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
