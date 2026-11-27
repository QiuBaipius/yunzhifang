// 独立仿真工程的配置常量（与云乘见线上规则一致）
import { CAMPUS_INTERNAL_IDS, RINGS_LNGLAT, STOPS_RAW } from './dalian.js'
import { PLATFORM_EXTRA, STOP_META } from './platforms.js'

// 像素/地图单位 与公里的换算：1km = 40 单位
export const UNITS_PER_KM = 40

// 派单规则参数（严格对应 PRD 车辆运行规则 3/4/5）
export const DISPATCH = {
  freeCancelMs: 40000, // 派单成功后 40s 内免费取消
  maxWaitMin: 20, // 预估等待超过 20min 不匹配
  detourMileageRatio: 1 / 3, // 绕路里程容忍阈值
  detourTimeRatio: 1 / 3, // 绕路时间容忍阈值
  farPickupMin: 10, // 接单距离远：预计到达上车点 ≥10 分钟
  addVehicleEtaMin: 10, // 派车阈值：匹配车辆预计到达 >10min 时从车场加派新车（可调）
  userWaitAlertMin: 10, // 用户视角重点呈现：等待超过 10 分钟的订单
  avgSpeedKmh: 30, // 仿真平均车速
}

// 运力动态调整（增派 / 减派 / 需求预测引导）
export const FLEET = {
  maxExtra: 8, // 单日最多从车场增派 8 辆
  retireIdleMin: 20, // 增派车辆连续空驶超过 20 分钟即减派回场
  serviceTimeMin: 8, // 平均每单占用车辆时间（接驾+送达+回空，Little 定律用）
  rebalanceHorizonMin: 15, // 需求预测窗口（分钟）
  rebalanceIntervalMin: 2, // 车辆引导重算间隔（分钟）
  retargetMinGapMin: 6, // 同一辆车两次改目标的最小间隔，避免来回摆
  maxRepositionKm: 4.5, // 超过该距离不再引导（避免把车抽空）
  minDeficit: 0.35, // 需求缺口小于该值时不动车
  proactiveAddDeficit: 1.2, // 缺口大于该值且无空闲车时主动增派
}

// 全部仿真按一天 05:30 — 23:45 运营（分钟序号，从 00:00 起算）
export const DEMAND = {
  windowStart: 5 * 60 + 30, // 05:30
  windowEnd: 23 * 60 + 45, // 23:45
  dayMin: 23 * 60 + 45 - (5 * 60 + 30), // 1095 分钟
}

// 车场：两条线路各有一座，增派车辆只从本线路车场出车
//   X1（软件园接驳 1 路）→ 凌水客运站（红凌路）
//   X2（凌水—小平岛接驳线）→ 和光大厦（尚水街）
export const DEPOTS = [
  { id: 'depotX1', lineId: 'X1', areaId: 'a1', name: '凌水客运站', lng: 121.528725, lat: 38.901127 },
  { id: 'depotX2', lineId: 'X2', areaId: 'a2', name: '和光大厦', lng: 121.543383, lat: 38.862044 },
]

// 兼容单车站场的老引用（取 X1 车场）
export const DEPOT = DEPOTS[0]

// 默认投放：X1 / X2 各自可独立调整（界面右上角两个滑杆）
export const INITIAL_FLEET = { X1: 8, X2: 4 }

// ---- 运营区与线路（与乘客端 web/src/data/config.js 完全一致）----
// a1：X1 软件园接驳 1 路（主运营区，含黑石礁街 / 西南路—南沙街 / 西北数码路—屹馨街三段延伸）
// a2：X2 凌水—小平岛接驳线（海事大学起，经七贤岭、小平岛、庙岭回到黄浦路的闭环，
//     第二十二轮起并入万达广场—和光大厦地块，与 X1 在该块重合）
export const AREAS = [
  { id: 'a1', line: 'X1', name: '软件园接驳区', hours: '06:30 – 22:30' },
  { id: 'a2', line: 'X2', name: '凌水—小平岛接驳区', hours: '06:00 – 21:00' },
]

// ---- 站台（乘降点）----
// 与乘客端同一套模型（第二十轮引入）：一个公交站按路侧拆成两个站台，
// 地铁站按真实出入口拆开，站体只作换乘枢纽。数据来源：
//   · data/dalian.js  STOPS_RAW       —— 高德采集的基础站点（153 个）
//   · data/platforms.js PLATFORM_EXTRA —— 对侧站台 + 地铁出入口（154 个）
// 合计 307 个站台，与云乘见的 STOPS 完全同构。
const SIDE_TXT = { N: '路北', S: '路南', E: '路东', W: '路西' }

// 某一侧站台服务哪个车行方向：靠右行驶时车行方向的右手侧才停得进去
export const SIDE_DIR = { N: 'W', S: 'E', E: 'N', W: 'S' }

// 地铁站下一班车信息（仅地铁站体有）
const METRO_ETA = [
  { dir: '往河口方向', left: 2, min: 4 },
  { dir: '往姚家方向', left: 3, min: 7 },
]

// 高校校内站点及其对侧站台全部剔除：车辆不进校园，校内点不能呼叫接驳车
const RAW_ALL = [...STOPS_RAW, ...PLATFORM_EXTRA].filter(
  (s) => !CAMPUS_INTERNAL_IDS.includes(s.id) && !CAMPUS_INTERNAL_IDS.includes(s.base),
)

// 边界共站（跨区换乘点）：到两区边界的距离都 ≤ 220 m
const INTERCHANGE_TOL_M = 220

function ringDistM(lng, lat, ring) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0]
    const ay = ring[j][1]
    const dx = (ring[i][0] - ax) * kx
    const dy = (ring[i][1] - ay) * ky
    const L = dx * dx + dy * dy
    let t = L ? ((lng - ax) * kx * dx + (lat - ay) * ky * dy) / L : 0
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot((lng - ax) * kx - t * dx, (lat - ay) * ky - t * dy)
    if (d < best) best = d
  }
  return best
}

export const INTERCHANGE_IDS = new Set(
  RAW_ALL.filter((s) => {
    const d1 = Math.min(...RINGS_LNGLAT.a1.map((r) => ringDistM(s.lng, s.lat, r)))
    const d2 = Math.min(...RINGS_LNGLAT.a2.map((r) => ringDistM(s.lng, s.lat, r)))
    return d1 <= INTERCHANGE_TOL_M && d2 <= INTERCHANGE_TOL_M
  }).map((s) => s.id),
)

export const STOPS = RAW_ALL.map((s) => {
  const meta = STOP_META[s.id] || {}
  const isMetroStation = !!s.metro // 运营中的地铁站「站体」（换乘枢纽，不代表某个站台）
  const areaId = s.area || 'a1'
  const both = INTERCHANGE_IDS.has(s.id)
  const side = s.side || meta.side || null
  const label = s.label || meta.label || (side ? SIDE_TXT[side] : null)
  const isExit = !!s.stationId
  const pairId = isExit ? null : s.twin || meta.twin || s.base || null
  const baseName = s.name.replace(/地铁站$/, '')
  const name = isMetroStation ? `${baseName}地铁站` : label ? `${s.name}（${label}）` : s.name
  // 停靠线路：站点主属 a2 → 只有 X2；跨区边界共站 → 两条线都停
  const lines = s.lines || (both ? ['X1', 'X2'] : areaId === 'a2' ? ['X2'] : ['X1'])
  return {
    id: s.id,
    name,
    rawName: s.name,
    x: s.x,
    y: s.y,
    type: s.type,
    areaId,
    // 可服务本站的线路所对应的运营区（仿真引擎按它筛站、按它判断跨区）
    areaIds: lines.map((l) => (l === 'X2' ? 'a2' : 'a1')),
    lines,
    side,
    sideTxt: side ? SIDE_TXT[side] : null,
    serveDir: side ? SIDE_DIR[side] : null,
    ...(isExit ? {} : pairId ? { twin: pairId } : {}),
    ...(s.base ? { base: s.base } : {}),
    ...(isExit ? { stationId: s.stationId, exit: s.exit, metroExit: true } : {}),
    ...(isMetroStation ? { hub: true, station: true, metro: METRO_ETA } : {}),
    ...(both ? { interchange: true } : {}),
    ...(s.planned ? { planned: true } : {}),
    ...(meta.hidden ? { hidden: true, mergedInto: meta.mergedInto } : {}),
    ...(areaId === 'a2' ? { area2: true } : {}),
  }
})

// 站台份额：同一处地点（路两侧的两个站台 / 地铁站体与各出入口）平分该地块的需求强度，
// 否则站台拆分会让全网需求凭空翻倍。
const GROUP_SIZE = new Map()
for (const s of STOPS) {
  const g = s.base || s.id
  GROUP_SIZE.set(g, (GROUP_SIZE.get(g) || 0) + 1)
}
for (const s of STOPS) {
  const g = s.base || s.id
  s.share = 1 / (GROUP_SIZE.get(g) || 1)
}

export const STOP_BY_ID = new Map(STOPS.map((s) => [s.id, s]))

// 线路途经站台：只列基准站（对侧站台是同一处地点，列出来会翻倍），与乘客端口径一致
const LINE_STOPS = (lineId) =>
  STOPS.filter((s) => s.lines.includes(lineId) && !s.base && !s.hidden).map((s) => s.id)

export const LINES = [
  {
    id: 'X1',
    name: '软件园接驳 1 路',
    areaId: 'a1',
    hours: '06:30 – 22:30',
    stops: LINE_STOPS('X1'),
  },
  {
    id: 'X2',
    name: '凌水—小平岛接驳线',
    areaId: 'a2',
    hours: '06:00 – 21:00',
    stops: LINE_STOPS('X2'),
  },
]

// 计价参数（一口价）
export const PRICING = {
  baseFare: 1, // 起步价 1 元（1km 内）
  baseKm: 1,
  perKm: 0.75, // 后续每公里 0.75 元
}

// 车辆参数
export const VEHICLE = {
  seats: 9, // 座位数
  capacity: 17, // 满载人数（不允许超员）
}

// 运营成本参数（元/车·日 与 元/公里）
//
// 口径依据：
//   1) 《城市公共汽电车企业运营成本测算规范》(DB3306/T 068-2024)：
//      运营成本 = 人工成本 + 能耗费 + 折旧摊销 + 保养维修费 + 保险安全费 + 其他运营支出 + 管理费用。
//   2) 江阴市公交成本规制标准值（元/千公里）：人工 3059.85、折旧 1000、电 752.42（含充电服务费）、
//      保养修理 355.23、保险安全 192.28、其他运营 376.23、管理费用 153.41。
//   3) 三明市 / 仁怀市成本规制：驾驶员人车比 1.5:1（每日 16 小时两班），其他人员 : 驾驶员 = 0.65。
//   4) 9 座纯电营运轻客实测百公里电耗 16.4 ~ 19.5 kWh（五菱扬光 Pro 16.4、图雅诺 19.5、瑞风 E3 约 17.5）。
//
// 本工程车辆为 9 座纯电微公交（不是 10m 大公交），因此：
//   人工按 1.2 人车比（司机 + 替班，不含大公交的站务/修理编制）；
//   折旧按 23 万元 / 8 年 / 365 天；电耗 0.18 kWh/km；电价 0.75 元/kWh（含充电服务费）。
export const COST = {
  driverDailyWage: 260, // 元/人·日（驾驶员月薪约 5500 元 ÷ 26 个工作日 + 社保折算）
  driversPerVehicle: 1.2, // 人车比
  vehiclePrice: 230000, // 元，9 座纯电营运轻客购置价
  vehicleLifeYears: 8, // 年，残值按 0 计
  dailyManagement: 25, // 元/车·日（管理费用 153.41 元/千公里 × 6 万公里/年 ÷ 365）
  dailyInsurance: 32, // 元/车·日（保险安全费 192.28 元/千公里 × 6 万公里/年 ÷ 365）
  kwhPerKm: 0.18, // kWh/km
  electricityPrice: 0.75, // 元/kWh
  maintenancePerKm: 0.36, // 元/km（保养修理费 355.23 元/千公里）
  otherPerKm: 0.38, // 元/km（其他运营支出 376.23 元/千公里）
}
