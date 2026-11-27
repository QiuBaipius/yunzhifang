// 分站点 · 分时段需求模型
//
// 需求不再是「随机撒点 + 恒定强度」，而是由两个维度决定：
//   1) 站点维度：每个站点的用地性质（写字楼 / 地铁站 / 医院 / 商业综合体 / 学校 / 高中 / 住宅区）
//      决定它一天的需求曲线形状与峰值强度；用户可逐站覆盖类型与「需求程度」。
//   2) 时间维度：同一站点在一天中的不同时段强度不同（如高中 21:00 晚自习放学为全天峰值）。
//
// 曲线依据城市公交客流调查的普遍规律（工作日双峰、学校上下学、医院上午门诊、商场傍晚、
// 住宅区早出晚归、地铁站早晚通勤接驳）按分钟插值生成，运营窗口 05:30 — 23:45。
import { DEMAND } from '../data/config.js'

// ---------------- 时间工具 ----------------
export function fmtClock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function fmtSpeed(kmh) {
  return `${kmh.toFixed(0)} km/h`
}

// ---------------- 用地类型与需求曲线 ----------------
// 每个点为 [一天中的分钟, 相对强度 0~1]，按分钟线性插值；窗口外为 0。
const PROFILES = {
  office: [
    [330, 0], [390, 0.08], [420, 0.35], [465, 0.85], [500, 1.0], [540, 0.62],
    [600, 0.4], [660, 0.42], [720, 0.5], [780, 0.36], [840, 0.4], [900, 0.46],
    [960, 0.58], [1020, 0.78], [1055, 0.95], [1080, 1.0], [1120, 0.7], [1180, 0.38],
    [1240, 0.2], [1320, 0.1], [1425, 0],
  ],
  metro: [
    [330, 0], [360, 0.18], [390, 0.42], [435, 0.88], [480, 0.95], [515, 0.85],
    [570, 0.5], [630, 0.45], [690, 0.5], [750, 0.44], [810, 0.4], [870, 0.4],
    [930, 0.45], [990, 0.55], [1035, 0.82], [1080, 1.0], [1115, 0.86], [1170, 0.6],
    [1230, 0.44], [1290, 0.3], [1350, 0.16], [1425, 0],
  ],
  hospital: [
    [330, 0], [390, 0.15], [420, 0.45], [465, 0.9], [510, 1.0], [570, 0.85],
    [630, 0.6], [690, 0.45], [750, 0.5], [810, 0.58], [870, 0.52], [930, 0.42],
    [990, 0.32], [1050, 0.2], [1110, 0.14], [1230, 0.05], [1425, 0],
  ],
  mall: [
    [330, 0], [480, 0.1], [540, 0.2], [600, 0.38], [660, 0.52], [720, 0.58],
    [780, 0.6], [840, 0.68], [900, 0.75], [960, 0.84], [1020, 0.9], [1080, 1.0],
    [1140, 0.95], [1200, 0.8], [1260, 0.6], [1320, 0.35], [1380, 0.15], [1425, 0],
  ],
  school: [
    [330, 0], [390, 0.1], [415, 0.5], [440, 1.0], [470, 0.5], [515, 0.18],
    [690, 0.35], [720, 0.55], [760, 0.2], [810, 0.45], [870, 0.15], [930, 0.32],
    [985, 0.5], [1010, 0.85], [1050, 0.6], [1110, 0.2], [1200, 0.1], [1300, 0.04], [1425, 0],
  ],
  highschool: [
    [330, 0], [380, 0.22], [405, 0.62], [435, 0.82], [480, 0.3], [700, 0.15],
    [730, 0.3], [775, 0.2], [850, 0.15], [960, 0.2], [1020, 0.45], [1050, 0.62],
    [1230, 0.35], [1260, 0.9], [1290, 1.0], [1325, 0.55], [1380, 0.15], [1425, 0],
  ],
  residential: [
    [330, 0], [360, 0.18], [390, 0.58], [420, 0.95], [450, 0.9], [485, 0.6],
    [540, 0.35], [600, 0.3], [660, 0.3], [720, 0.28], [780, 0.28], [840, 0.28],
    [900, 0.3], [960, 0.36], [1020, 0.5], [1055, 0.66], [1085, 0.86], [1125, 0.78],
    [1170, 0.6], [1230, 0.45], [1290, 0.3], [1350, 0.15], [1425, 0],
  ],
}

export const CATEGORIES = [
  { key: 'office', label: '写字楼 / 产业园', color: '#2d6cdf', peakRate: 0.05, hint: '08:00–09:00、17:30–18:30 通勤双峰' },
  { key: 'metro', label: '地铁站', color: '#d92b2b', peakRate: 0.085, hint: '07:00–09:00、17:30–19:00 接驳双峰' },
  { key: 'hospital', label: '医院', color: '#b45309', peakRate: 0.045, hint: '08:00–11:00 门诊高峰' },
  { key: 'mall', label: '商业综合体', color: '#b06fc4', peakRate: 0.065, hint: '11:00–21:00，18:00 后为峰值' },
  { key: 'school', label: '学校', color: '#0f7a62', peakRate: 0.05, hint: '07:20 上学、16:40 放学' },
  { key: 'highschool', label: '高中（晚自习）', color: '#14967a', peakRate: 0.05, hint: '06:50 上学、21:10 晚自习放学为峰值' },
  { key: 'residential', label: '居民住宅区', color: '#7b8794', peakRate: 0.04, hint: '07:00 早出、18:30 晚归' },
]

export const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.key, c]))

function profilePoints(cat) {
  return PROFILES[cat] || PROFILES.residential
}

// 曲线插值：返回 0~1 的相对强度
export function profileWeight(cat, tMin) {
  if (tMin <= DEMAND.windowStart || tMin >= DEMAND.windowEnd) return 0
  const pts = profilePoints(cat)
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, w0] = pts[i]
    const [t1, w1] = pts[i + 1]
    if (tMin >= t0 && tMin <= t1) {
      const k = t1 === t0 ? 0 : (tMin - t0) / (t1 - t0)
      return w0 + (w1 - w0) * k
    }
  }
  return 0
}

// 该类用地的全天峰值时刻（用于界面提示「自动匹配依据」）
export function peakMoment(cat) {
  const pts = profilePoints(cat)
  let best = pts[0]
  for (const p of pts) if (p[1] > best[1]) best = p
  return { minute: best[0], weight: best[1], clock: fmtClock(best[0]) }
}

// ---------------- 站点用地类型自动识别 ----------------
const RULES = [
  { key: 'metro', test: (s) => !!s.metro || !!s.metroExit, reason: '地铁站点' },
  { key: 'hospital', test: (s) => /医院|七院|诊所|卫生院|医科|急救/.test(s.name), reason: '名称含医院类关键词' },
  { key: 'highschool', test: (s) => /高中|中学/.test(s.name), reason: '名称含高中/中学' },
  {
    key: 'school',
    test: (s) => /学校|大学|学院|小学|双语|职业技术|理工|财经|海事|东软|轻工/.test(s.name),
    reason: '名称含学校类关键词',
  },
  { key: 'mall', test: (s) => /广场|万达|商场|市场|商业|购物|超市|新玛特/.test(s.name), reason: '名称含商业类关键词' },
  {
    key: 'office',
    test: (s) => /软件园|大厦|创业|科技|产业园|写字楼|数码|国际新城|售楼处/.test(s.name),
    reason: '名称含办公/产业园关键词',
  },
  { key: 'residential', test: () => true, reason: '默认按居民区/街边站点处理' },
]

export function classifyStop(stop) {
  for (const r of RULES) {
    if (r.test(stop)) return { category: r.key, reason: r.reason }
  }
  return { category: 'residential', reason: '默认' }
}

// ---------------- 需求模型 ----------------
export class DemandModel {
  // opts: { stops, settings: { [stopId]: { category, level } }, windowStart, windowEnd }
  constructor({ stops = [], settings = {}, windowStart = DEMAND.windowStart, windowEnd = DEMAND.windowEnd } = {}) {
    this.stops = stops
    this.windowStart = windowStart
    this.windowEnd = windowEnd
    this.meta = new Map()
    this.index = new Map(stops.map((s, i) => [s.id, i]))
    this.rateBuffer = new Float64Array(stops.length)

    for (const s of stops) {
      const auto = classifyStop(s)
      const ov = settings[s.id] || {}
      const category = CATEGORY_MAP.has(ov.category) ? ov.category : auto.category
      const level = ov.level == null ? 1 : Math.max(0, Math.min(3, Number(ov.level) || 0))
      const cat = CATEGORY_MAP.get(category)
      this.meta.set(s.id, {
        stop: s,
        category,
        categoryLabel: cat.label,
        autoCategory: auto.category,
        autoReason: auto.reason,
        level,
        // 同一处地点的路两侧站台 / 地铁站体与出入口平分该地块的需求强度，
        // 站台拆分（第二十轮）不会让全网需求凭空翻倍
        peakRate: cat.peakRate * level * (s.share ?? 1), // 该站全天峰值呼叫强度（单/分钟）
      })
    }
  }

  metaOf(stopId) {
    return this.meta.get(stopId) || null
  }

  // 某站某时刻的呼叫强度（单/分钟）
  rateOf(stopId, tMin) {
    const m = this.meta.get(stopId)
    if (!m) return 0
    return m.peakRate * profileWeight(m.category, tMin)
  }

  // 全部站点的瞬时强度（与 stops 同序），每步只算一次
  ratesAt(tMin) {
    const out = this.rateBuffer
    for (let i = 0; i < this.stops.length; i++) {
      const m = this.meta.get(this.stops[i].id)
      out[i] = m ? m.peakRate * profileWeight(m.category, tMin) : 0
    }
    return out
  }

  totalRate(tMin) {
    let s = 0
    for (const st of this.stops) s += this.rateOf(st.id, tMin)
    return s
  }

  // 未来一段时间的预计呼叫数（三点梯形积分）
  expectedCalls(stopId, tMin, minutes = 15) {
    const m = this.meta.get(stopId)
    if (!m) return 0
    const steps = 4
    let sum = 0
    for (let i = 0; i < steps; i++) {
      const t0 = tMin + (minutes * i) / steps
      const t1 = tMin + (minutes * (i + 1)) / steps
      sum += ((this.rateOf(stopId, t0) + this.rateOf(stopId, t1)) / 2) * (t1 - t0)
    }
    return sum
  }

  // 抽样起点：按当前各站强度的加权随机
  pickOrigin(tMin, rng) {
    const rates = this.ratesAt(tMin)
    let total = 0
    for (let i = 0; i < rates.length; i++) total += rates[i]
    if (total <= 1e-9) return null
    let r = rng() * total
    for (let i = 0; i < rates.length; i++) {
      r -= rates[i]
      if (r <= 0) return this.stops[i]
    }
    return this.stops[this.stops.length - 1]
  }

  // 抽样终点：引力模型（目的地活跃度 × 距离衰减），让 OD 更符合真实接驳特征
  pickDestination(fromStop, tMin, rng, distKm) {
    const weights = []
    let total = 0
    for (const s of this.stops) {
      if (s.id === fromStop.id) {
        weights.push(0)
        continue
      }
      // 两条线路各自独立运营（X1 / X2），不生成跨运营区的出行需求
      const fa = fromStop.areaIds || (fromStop.areaId ? [fromStop.areaId] : null)
      const ta = s.areaIds || (s.areaId ? [s.areaId] : null)
      if (fa && ta && !ta.some((a) => fa.includes(a))) {
        weights.push(0)
        continue
      }
      const d = distKm(fromStop, s)
      const attract = this.rateOf(s.id, tMin) + 0.012
      const w = attract * Math.exp(-(isFinite(d) ? d : 5) / 4)
      weights.push(w)
      total += w
    }
    if (total <= 1e-9) return null
    let r = rng() * total
    for (let i = 0; i < this.stops.length; i++) {
      r -= weights[i]
      if (r <= 0) return this.stops[i]
    }
    return this.stops[this.stops.length - 1]
  }

  // 全天各小时总需求（用于界面预览曲线）
  hourlyCurve() {
    const out = []
    for (let h = 0; h < 24; h++) {
      const t = h * 60 + 30
      out.push({ hour: h, rate: this.totalRate(t) })
    }
    return out
  }
}
