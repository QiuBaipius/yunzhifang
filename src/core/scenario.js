// 场景（Scenario）：仿真的「配置文件」层，对齐 SUMO 的 .sumocfg 思路，但全部中文化、可读化。
//
//   {
//     "名称": "大连软件园 · 工作日基准",
//     "路网": { "种子": 20261022, "规模": "standard" },
//     "需求": { "倍数": 1, "站点": { "b12": { "类型": "highschool", "程度": 1.2 } } },
//     "车队": { "初始车辆": { "X1": 8, "X2": 4 }, "座位数": 9, "容量": 17, "自动增派": true, "最多增派": 8 },
//     "调度": { "派车阈值": 10, "绕行预算": 0.333, "最长等待": 20, "预测引导": true, "局部重排": true },
//     "仿真": { "开始": "05:30", "结束": "23:45", "步长": 0.5, "随机种子": 7 },
//     "输出": { "目录": "runs", "订单": true, "车辆": true, "轨迹": true, "指标": true }
//   }
//
// 同时接受英文键名（vehicles / thresholdMin / ...），方便脚本化调用。
import { DEMAND, DISPATCH, FLEET, INITIAL_FLEET, LINES, VEHICLE } from '../data/config.js'

const pick = (obj, keys, fallback) => {
  for (const k of keys) if (obj && obj[k] != null) return obj[k]
  return fallback
}

export function parseClock(text, fallback) {
  if (text == null) return fallback
  if (typeof text === 'number') return text
  const m = String(text).trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return fallback
  return Number(m[1]) * 60 + Number(m[2])
}

export function formatClock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const SIZE_LABEL = { compact: '精简', standard: '标准', large: '完整' }

// 站点级覆盖：同时接受「类型 / 程度」与 DemandModel 的 category / level（含纯数字简写）
export function normalizeStopSettings(raw) {
  const out = {}
  for (const [id, v] of Object.entries(raw || {})) {
    if (v == null) continue
    if (typeof v === 'number') {
      out[id] = { level: v }
      continue
    }
    if (typeof v === 'string') {
      out[id] = { category: v }
      continue
    }
    if (typeof v !== 'object') continue
    const item = {}
    const category = pick(v, ['类型', '用地类型', 'category'], null)
    const level = pick(v, ['程度', '等级', '强度', 'level'], null)
    if (category != null) item.category = String(category)
    if (level != null) item.level = Number(level)
    if (Object.keys(item).length) out[id] = item
  }
  return out
}

export function defaultScenario(overrides = {}) {
  return {
    名称: overrides.名称 || '大连软件园 · 工作日基准',
    说明: '05:30–23:45 全日仿真：分站点分时段需求 + 可行插入拼车 + 10 分钟阈值增派 + 需求预测引导',
    路网: { 种子: 20261022, 规模: 'standard', ...(overrides.路网 || {}) },
    需求: { 倍数: 1, 站点: {}, ...(overrides.需求 || {}) },
    车队: {
      初始车辆: { ...INITIAL_FLEET },
      座位数: VEHICLE.seats,
      容量: VEHICLE.capacity,
      自动增派: true,
      最多增派: FLEET.maxExtra,
      ...(overrides.车队 || {}),
    },
    调度: {
      派车阈值: DISPATCH.addVehicleEtaMin,
      绕行预算: DISPATCH.detourMileageRatio,
      最长等待: DISPATCH.maxWaitMin,
      预测引导: true,
      局部重排: true,
      ...(overrides.调度 || {}),
    },
    仿真: {
      开始: '05:30',
      结束: '23:45',
      步长: 0.5,
      随机种子: 7,
      记录轨迹: true,
      ...(overrides.仿真 || {}),
    },
    输出: { 目录: 'runs', 订单: true, 车辆: true, 轨迹: true, 指标: true, ...(overrides.输出 || {}) },
  }
}

// 初始车辆：既支持总数（数字），也支持按线路分别投放（{ "X1": 8, "X2": 4 }）
export function fleetPlan(raw) {
  if (raw && typeof raw === 'object') {
    const counts = {}
    for (const l of LINES) counts[l.id] = Math.max(0, Math.floor(Number(raw[l.id]) || 0))
    return { vehicles: Object.values(counts).reduce((s, n) => s + n, 0), counts }
  }
  return { vehicles: Number(raw), counts: null }
}

// 统一读取（中文键优先，英文键兜底）
export function readScenario(sc) {
  const net = pick(sc, ['路网', 'network'], {}) || {}
  const dem = pick(sc, ['需求', 'demand'], {}) || {}
  const fleet = pick(sc, ['车队', 'fleet'], {}) || {}
  const disp = pick(sc, ['调度', 'dispatch'], {}) || {}
  const sim = pick(sc, ['仿真', 'simulation', 'sim'], {}) || {}
  const out = pick(sc, ['输出', 'outputs', 'output'], {}) || {}

  return {
    name: pick(sc, ['名称', 'name'], '未命名场景'),
    desc: pick(sc, ['说明', 'description'], ''),
    network: {
      seed: Number(pick(net, ['种子', 'seed'], 20261022)),
      size: String(pick(net, ['规模', 'size'], 'standard')),
    },
    demand: {
      scale: Number(pick(dem, ['倍数', 'scale'], 1)),
      stops: normalizeStopSettings(pick(dem, ['站点', 'stops'], {})),
    },
    fleet: {
      ...fleetPlan(pick(fleet, ['初始车辆', 'vehicles'], INITIAL_FLEET)),
      seats: Number(pick(fleet, ['座位数', 'seats'], VEHICLE.seats)),
      capacity: Number(pick(fleet, ['容量', 'capacity'], VEHICLE.capacity)),
      autoFleet: pick(fleet, ['自动增派', 'autoFleet'], true) !== false,
      maxExtra: Number(pick(fleet, ['最多增派', 'maxExtra'], FLEET.maxExtra)),
    },
    dispatch: {
      thresholdMin: Number(pick(disp, ['派车阈值', 'thresholdMin'], DISPATCH.addVehicleEtaMin)),
      detourRatio: Number(pick(disp, ['绕行预算', 'detourRatio'], DISPATCH.detourMileageRatio)),
      waitMaxMin: Number(pick(disp, ['最长等待', 'waitMaxMin'], DISPATCH.maxWaitMin)),
      rebalanceOn: pick(disp, ['预测引导', 'rebalanceOn'], true) !== false,
      poolLocalSearch: pick(disp, ['局部重排', 'poolLocalSearch'], true) !== false,
    },
    sim: {
      start: parseClock(pick(sim, ['开始', 'start'], null), DEMAND.windowStart),
      end: parseClock(pick(sim, ['结束', 'end'], null), DEMAND.windowEnd),
      stepMin: Number(pick(sim, ['步长', 'stepMin'], 0.5)),
      seed: Number(pick(sim, ['随机种子', 'seed'], 7)),
      record: pick(sim, ['记录轨迹', 'record'], true) !== false,
    },
    output: {
      dir: String(pick(out, ['目录', 'dir'], 'runs')),
      orders: pick(out, ['订单', 'orders'], true) !== false,
      vehicles: pick(out, ['车辆', 'vehicles'], true) !== false,
      trajectories: pick(out, ['轨迹', 'trajectories'], true) !== false,
      kpis: pick(out, ['指标', 'kpis'], true) !== false,
    },
  }
}

// 校验：返回中文错误列表（空数组 = 通过）
export function validateScenario(sc) {
  const c = readScenario(sc)
  const errs = []
  const num = (v) => typeof v === 'number' && isFinite(v)

  if (!['compact', 'standard', 'large'].includes(c.network.size)) {
    errs.push(`路网规模只能是 compact / standard / large（当前：${c.network.size}）`)
  }
  if (!num(c.network.seed) || c.network.seed < 1) errs.push('路网种子必须是 ≥1 的整数')
  if (!num(c.fleet.vehicles) || c.fleet.vehicles < 1 || c.fleet.vehicles > 80) errs.push('初始车辆数必须在 1–80 之间')
  if (!num(c.fleet.seats) || c.fleet.seats < 1 || c.fleet.seats > 60) errs.push('座位数必须在 1–60 之间')
  if (!num(c.fleet.capacity) || c.fleet.capacity < c.fleet.seats) errs.push('容量必须 ≥ 座位数（不允许超员）')
  if (!num(c.demand.scale) || c.demand.scale < 0 || c.demand.scale > 5) errs.push('需求倍数必须在 0–5 之间')
  if (!num(c.dispatch.thresholdMin) || c.dispatch.thresholdMin < 1 || c.dispatch.thresholdMin > 60) {
    errs.push('派车阈值必须在 1–60 分钟之间')
  }
  if (!num(c.dispatch.detourRatio) || c.dispatch.detourRatio < 0 || c.dispatch.detourRatio > 1) {
    errs.push('绕行预算必须在 0–1 之间（0.333 表示 33%）')
  }
  if (!num(c.dispatch.waitMaxMin) || c.dispatch.waitMaxMin < 1 || c.dispatch.waitMaxMin > 60) {
    errs.push('最长等待必须在 1–60 分钟之间')
  }
  if (!num(c.sim.stepMin) || c.sim.stepMin < 0.1 || c.sim.stepMin > 1) errs.push('仿真步长必须在 0.1–1 分钟之间')
  if (c.sim.end <= c.sim.start) errs.push('结束时刻必须晚于开始时刻')
  if (!num(c.sim.seed)) errs.push('随机种子必须是数字')
  if (c.output.dir.includes('..')) errs.push('输出目录不能包含 “..”')
  if (!c.output.orders && !c.output.vehicles && !c.output.trajectories && !c.output.kpis) {
    errs.push('至少要选择一种输出（订单 / 车辆 / 轨迹 / 指标）')
  }
  return errs
}

export function scenarioSummary(sc) {
  const c = readScenario(sc)
  const fleetText = c.fleet.counts
    ? Object.entries(c.fleet.counts).map(([k, n]) => `${k} ${n} 辆`).join(' + ')
    : `${c.fleet.vehicles} 辆`
  return `${c.name}｜${SIZE_LABEL[c.network.size] || c.network.size}路网 · ${fleetText} · 需求 ${c.demand.scale}×｜${formatClock(
    c.sim.start,
  )}–${formatClock(c.sim.end)}｜阈值 ${c.dispatch.thresholdMin} 分钟 · 绕行预算 ${(c.dispatch.detourRatio * 100).toFixed(0)}%`
}
