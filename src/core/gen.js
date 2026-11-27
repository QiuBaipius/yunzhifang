// 算法仿真系统 · 地图构建器（大连真实路网 + 真实站台）
//
// 与云乘见（乘客端）同一套模型：
//   · 站台 = 真实公交站按路侧拆分的两个站台 + 地铁站体与出入口（307 个，data/config.js 的 STOPS）
//   · 路网 = 高德驾车规划得到的 763 条真实折线（data/dalian-roads.js）按 25 m 合并成的一张图
//   · 站台不直接进图，只吸附到最近的道路节点上；任意两点之间沿路面走最短路
// 仿真的随机性体现在：站台抽样比例（仿真规模）、需求生成、车辆投放与派单。
import { DEPOTS, LINES, STOPS, UNITS_PER_KM } from '../data/config.js'
import { CAMPUS_INTERNAL_IDS, STOPS_RAW } from '../data/dalian.js'
import { ROAD_EDGES } from '../data/dalian-roads.js'
import { toXY } from '../data/geo.js'

// 可复现的伪随机数生成器（mulberry32）
export function makeRng(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 规模预设：控制参与仿真的站台比例（地铁站、X2 沿线站台始终保留）
export const SIZE_PRESETS = {
  compact: { ratio: 0.45, label: '精简（约一半站点）' },
  standard: { ratio: 0.72, label: '标准（多数站点）' },
  large: { ratio: 1, label: '完整（全部真实站点）' },
}

// 折线几何长度（抽象单位）
function ptsLen(pts) {
  let sum = 0
  for (let i = 0; i < pts.length - 1; i++) sum += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  return sum
}

// ---- 道路网 ----
// 把全部折线按 25 m 合并成一张图：折线拐点即节点，相邻拐点之间连双向边。
// 同一条路的上行/下行折线、不同站点出发的重叠路段都会并到一起，路口自然连通。
// 高校校内道路不参与接驳车行驶：剔除以校内设施站为端点的折线，
// 以及从它们旁边 37.5 m 内穿过的折线（折线拐点稀疏，段内按 1/5 取样检查）。
const CAMPUS_POINTS = STOPS_RAW.filter((s) => CAMPUS_INTERNAL_IDS.includes(s.id)).map((s) => [s.x, s.y])
const CAMPUS_RADIUS = 1.5
function entersCampus(e) {
  if (CAMPUS_INTERNAL_IDS.includes(e.a) || CAMPUS_INTERNAL_IDS.includes(e.b)) return true
  const inCampus = (p) => CAMPUS_POINTS.some((c) => Math.hypot(p[0] - c[0], p[1] - c[1]) < CAMPUS_RADIUS)
  for (let i = 0; i < e.pts.length; i++) {
    if (inCampus(e.pts[i])) return true
    if (i === 0) continue
    const [ax, ay] = e.pts[i - 1]
    const [bx, by] = e.pts[i]
    for (let t = 0.2; t < 1; t += 0.2) {
      if (inCampus([ax + (bx - ax) * t, ay + (by - ay) * t])) return true
    }
  }
  return false
}
const DRIVE_EDGES = ROAD_EDGES.filter((e) => !entersCampus(e))

const NET_MERGE = 1.0
const GX = 4096
const gkey = (gx, gy) => (gx + GX) * 8192 + (gy + GX)

const NET = buildNetwork()

function buildNetwork() {
  const nodes = []
  const adj = []
  const grid = new Map()

  const nodeAt = (x, y) => {
    const gx = Math.floor(x / NET_MERGE)
    const gy = Math.floor(y / NET_MERGE)
    let best = -1
    let bd = NET_MERGE * NET_MERGE
    for (let i = gx - 1; i <= gx + 1; i++) {
      for (let j = gy - 1; j <= gy + 1; j++) {
        const list = grid.get(gkey(i, j))
        if (!list) continue
        for (let k = 0; k < list.length; k++) {
          const n = list[k]
          const d = (nodes[n].x - x) ** 2 + (nodes[n].y - y) ** 2
          if (d < bd) {
            bd = d
            best = n
          }
        }
      }
    }
    if (best >= 0) return best
    const id = nodes.length
    nodes.push({ x, y })
    const k = gkey(gx, gy)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(id)
    adj.push([])
    return id
  }

  const link = (a, b) => {
    if (a === b) return
    const w = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) / UNITS_PER_KM
    if (!(w > 0)) return
    adj[a].push({ to: b, km: w })
    adj[b].push({ to: a, km: w })
  }

  for (const e of DRIVE_EDGES) {
    let prev = -1
    for (const p of e.pts) {
      const id = nodeAt(p[0], p[1])
      if (prev >= 0) link(prev, id)
      prev = id
    }
  }
  return { nodes, adj, grid }
}

// 任意点 → 最近的网络节点（先扫 3×3、再逐圈扩大，最后兜底全表）
function snapNode(p) {
  const { nodes, grid } = NET
  const gx = Math.floor(p.x / NET_MERGE)
  const gy = Math.floor(p.y / NET_MERGE)
  let best = -1
  let bd = Infinity
  for (let ring = 1; ring <= 12; ring++) {
    for (let i = gx - ring; i <= gx + ring; i++) {
      for (let j = gy - ring; j <= gy + ring; j++) {
        if (ring > 1 && Math.abs(i - gx) !== ring && Math.abs(j - gy) !== ring) continue
        const list = grid.get(gkey(i, j))
        if (!list) continue
        for (let k = 0; k < list.length; k++) {
          const n = list[k]
          const d = (nodes[n].x - p.x) ** 2 + (nodes[n].y - p.y) ** 2
          if (d < bd) {
            bd = d
            best = n
          }
        }
      }
    }
    if (best >= 0 && Math.sqrt(bd) <= ring * NET_MERGE - NET_MERGE) break
  }
  if (best >= 0) return { node: best, gap: Math.sqrt(bd) }
  for (let n = 0; n < nodes.length; n++) {
    const d = (nodes[n].x - p.x) ** 2 + (nodes[n].y - p.y) ** 2
    if (d < bd) {
      bd = d
      best = n
    }
  }
  return { node: best, gap: Math.sqrt(bd) }
}

// ---- 车场节点：X1 凌水客运站 / X2 和光大厦 ----
// 车场不在乘客站列表里，只作为车辆出入场的路网节点：吸附到最近的道路节点后接一小段直线。
for (const D of DEPOTS) {
  const p = toXY(D.lng, D.lat)
  const near = snapNode(p)
  const id = NET.nodes.length
  NET.nodes.push({ x: p.x, y: p.y })
  NET.adj.push([])
  const kmv = Math.hypot(NET.nodes[near.node].x - p.x, NET.nodes[near.node].y - p.y) / UNITS_PER_KM
  NET.adj[id].push({ to: near.node, km: kmv })
  NET.adj[near.node].push({ to: id, km: kmv })
  D.x = p.x
  D.y = p.y
  D.nodeId = id
}

// ---- 最短路（单源 Dijkstra，二叉堆 + 类型化数组）----
const NN = NET.nodes.length
const _dist = new Float64Array(NN)
const _prev = new Int32Array(NN)
const _seen = new Int32Array(NN)
const _done = new Uint8Array(NN)
// 堆容量：惰性删除会让同一节点被多次入堆，放开一倍图规模才够（7.6k 条边约 1.5 万次入堆）
let _cap = NN * 64
let _heap = new Int32Array(_cap)
let _hkey = new Float64Array(_cap)
let _stamp = 0
let _hn = 0

function hgrow() {
  _cap *= 2
  const h = new Int32Array(_cap)
  const k = new Float64Array(_cap)
  h.set(_heap)
  k.set(_hkey)
  _heap = h
  _hkey = k
}

function hpush(node, d) {
  if (_hn >= _cap) hgrow()
  let i = _hn++
  _heap[i] = node
  _hkey[i] = d
  while (i > 0) {
    const p = (i - 1) >> 1
    if (_hkey[p] <= _hkey[i]) break
    const tn = _heap[p]
    const tk = _hkey[p]
    _heap[p] = _heap[i]
    _hkey[p] = _hkey[i]
    _heap[i] = tn
    _hkey[i] = tk
    i = p
  }
}

function hpop() {
  const top = _heap[0]
  _hn--
  if (_hn > 0) {
    _heap[0] = _heap[_hn]
    _hkey[0] = _hkey[_hn]
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let m = i
      if (l < _hn && _hkey[l] < _hkey[m]) m = l
      if (r < _hn && _hkey[r] < _hkey[m]) m = r
      if (m === i) break
      const tn = _heap[m]
      const tk = _hkey[m]
      _heap[m] = _heap[i]
      _hkey[m] = _hkey[i]
      _heap[i] = tn
      _hkey[i] = tk
      i = m
    }
  }
  return top
}

// 单源最短路；dst < 0 表示跑完全图。返回是否到达 dst（全图跑完时恒为 true）
function dijkstraRun(src, dst = -1) {
  if (src == null || src < 0 || src >= NN) return false
  _stamp++
  _hn = 0
  _dist[src] = 0
  _seen[src] = _stamp
  _done[src] = 0
  _prev[src] = -1
  hpush(src, 0)
  while (_hn > 0) {
    const cur = hpop()
    if (_done[cur]) continue
    _done[cur] = 1
    if (cur === dst) return true
    const dv = _dist[cur]
    const list = NET.adj[cur]
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      const nd = dv + e.km
      if (_seen[e.to] !== _stamp) {
        _seen[e.to] = _stamp
        _done[e.to] = 0
        _dist[e.to] = nd
        _prev[e.to] = cur
        hpush(e.to, nd)
      } else if (!_done[e.to] && nd < _dist[e.to]) {
        _dist[e.to] = nd
        _prev[e.to] = cur
        hpush(e.to, nd)
      }
    }
  }
  return _seen[dst] === _stamp
}

// 节点对最短路（带路径），缓存
// 只缓存「算出来了」的结果：失败要么是瞬时的、要么值得重算一次，缓存 null 会让车辆永久丢路径
const netCache = new Map()
function netShortest(a, b) {
  if (a === b) return { km: 0, nodes: [a] }
  const key = a + '|' + b
  const hit = netCache.get(key)
  if (hit) return hit
  const found = dijkstraRun(a, b)
  if (!found) return null
  const path = []
  let cur = b
  for (let guard = 0; cur >= 0 && guard < NN + 5; guard++) {
    path.push(cur)
    if (cur === a) break
    cur = _prev[cur]
  }
  path.reverse()
  const res = { km: _dist[b], nodes: path }
  if (netCache.size > 30000) netCache.clear()
  netCache.set(key, res)
  return res
}

// 单源全图距离（一次 Dijkstra 供一批查询用，避免逐对跑）
const distFrom = new Map()
function distTable(src) {
  let t = distFrom.get(src)
  if (t) return t
  dijkstraRun(src, -1)
  t = new Float64Array(NN).fill(Infinity)
  for (let i = 0; i < NN; i++) if (_seen[i] === _stamp) t[i] = _dist[i]
  if (distFrom.size > 600) distFrom.clear()
  distFrom.set(src, t)
  return t
}

// 构建地图
// opts: { seed, size, lineCount }
export function generateMap(opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9)
  const rng = makeRng(seed)
  const preset = SIZE_PRESETS[opts.size || 'standard']
  const ratio = opts.ratio ?? preset.ratio

  // ---- 站台抽样 ----
  // 路网已经是完整连通的道路网，抽样只影响「仿真里有多少个乘降点」。
  // 仍沿用「从地铁站沿真实道路向外生长」的方式：抽出来的站台在空间上是连片的一片，
  // 而不是满图散点，这样需求分布与车辆巡游范围才接近真实运营。
  const adjFull = new Map()
  for (const e of DRIVE_EDGES) {
    if (!adjFull.has(e.a)) adjFull.set(e.a, [])
    if (!adjFull.has(e.b)) adjFull.set(e.b, [])
    adjFull.get(e.a).push(e.b)
    adjFull.get(e.b).push(e.a)
  }

  const target = Math.max(1, Math.min(STOPS_RAW.length, Math.round(STOPS_RAW.length * ratio)))
  const metroIds = STOPS_RAW.filter((s) => s.metro).map((s) => s.id)
  const root = metroIds[0] || STOPS_RAW[0].id
  const keep = new Set([root])
  // X2 沿线站点较少，抽样丢掉会让第二条线失去意义，因此固定保留
  for (const s of STOPS_RAW) if (s.area === 'a2') keep.add(s.id)
  const frontier = new Set()
  const grow = (id) => {
    for (const n of adjFull.get(id) || []) if (!keep.has(n)) frontier.add(n)
  }
  grow(root)
  while (keep.size < target && frontier.size) {
    const metroCands = [...frontier].filter((id) => metroIds.includes(id))
    const pool = metroCands.length ? metroCands : [...frontier]
    const pickId = pool[Math.floor(rng() * pool.length)]
    frontier.delete(pickId)
    keep.add(pickId)
    grow(pickId)
  }
  // 还有没接进来的地铁站（离起点太远）：沿全图最短路径把中间站一并补上
  const bridgeTo = (toId) => {
    const prev = new Map()
    const seen = new Set(keep)
    let queue = [...keep]
    let found = false
    while (queue.length && !found) {
      const next = []
      for (const u of queue) {
        for (const v of adjFull.get(u) || []) {
          if (seen.has(v)) continue
          seen.add(v)
          prev.set(v, u)
          next.push(v)
          if (v === toId) {
            found = true
            break
          }
        }
        if (found) break
      }
      queue = next
    }
    if (!found) return []
    const path = []
    let cur = toId
    while (cur != null && !keep.has(cur)) {
      path.push(cur)
      cur = prev.get(cur)
    }
    return path.reverse()
  }
  for (const id of metroIds) {
    if (keep.has(id)) continue
    for (const id2 of bridgeTo(id)) {
      keep.add(id2)
      grow(id2)
    }
  }

  // 站台：基准站被抽中 → 它自己与它的对侧站台 / 出入口一起进入仿真
  const stops = STOPS.filter((s) => {
    if (s.hidden) return false
    if (keep.has(s.id)) return true
    if (s.base && keep.has(s.base)) return true
    if (s.stationId && keep.has(s.stationId)) return true
    return false
  }).map((s) => {
    const snap = snapNode(s)
    return { ...s, nodeId: snap.node, snapGap: snap.gap }
  })
  const stopByIdMap = new Map(stops.map((s) => [s.id, s]))
  const stopsByNode = new Map()
  for (const s of stops) if (!stopsByNode.has(s.nodeId)) stopsByNode.set(s.nodeId, s)

  // ---- 路网（对外暴露的图结构）----
  const nodes = NET.nodes.map((n, i) => ({ id: i, x: n.x, y: n.y }))
  const nodeAt = new Map(nodes.map((n) => [n.id, n]))
  const adj = NET.adj
  const edgeMap = new Map()
  for (let a = 0; a < NN; a++) {
    const na = NET.nodes[a]
    for (const e of adj[a]) {
      const nb = NET.nodes[e.to]
      const ab = { a, b: e.to, km: e.km, len: e.km * UNITS_PER_KM, pts: [[na.x, na.y], [nb.x, nb.y]] }
      edgeMap.set(a + '|' + e.to, ab)
    }
  }

  // 展示用：剔除校园内部路段后的真实站间道路，只用于界面上报「多少段真实道路」
  const edges = []
  for (const e of DRIVE_EDGES) {
    const pts = e.pts.map((p) => [p[0], p[1]])
    edges.push({ a: e.a, b: e.b, km: e.km, len: ptsLen(pts), pts })
  }

  // ---- 车场 ----
  const depots = DEPOTS.map((D) => ({
    id: D.id,
    name: D.name,
    lineId: D.lineId,
    areaId: D.areaId,
    x: D.x,
    y: D.y,
    nodeId: D.nodeId,
  }))
  const depot = depots[0] || null

  // ---- 线路：直接采用乘客端的真实运营线路 X1 / X2 ----
  const LINE_COLOR_OF = { X1: '#0f7a62', X2: '#7c5cd6' }
  const lines = []
  for (const L of LINES) {
    const seg = L.stops.filter((id) => stopByIdMap.has(id))
    if (seg.length < 2) continue
    lines.push({
      id: L.id,
      name: L.name,
      areaId: L.areaId,
      hours: L.hours,
      color: LINE_COLOR_OF[L.id] || '#0f7a62',
      stops: seg,
    })
  }

  // ---- 站台间沿道路的里程与路径 ----
  // 站台不进图：对侧站台 / 地铁出入口用它们的「基准站」所在节点，最后把站台自身的一小段接回去。
  const baseOf = (s) => (s && s.base && stopByIdMap.has(s.base) ? s.base : s && s.id)
  const routeCache = new Map()

  function stopRoute(fromId, toId) {
    const a0 = stopByIdMap.get(fromId)
    const b0 = stopByIdMap.get(toId)
    if (!a0 || !b0) return { km: Infinity, nodes: [], pts: [] }
    const f = baseOf(a0)
    const t = baseOf(b0)
    const A = stopByIdMap.get(f) || a0
    const B = stopByIdMap.get(t) || b0
    const aNode = A.nodeId
    const bNode = B.nodeId
    if (aNode === bNode) {
      const d = Math.hypot(a0.x - b0.x, a0.y - b0.y) / UNITS_PER_KM
      return { km: d, nodes: [aNode], pts: [[a0.x, a0.y], [b0.x, b0.y]] }
    }
    const key = f + '>' + t
    let base = routeCache.get(key)
    if (base === undefined) {
      const sp = netShortest(aNode, bNode)
      base = sp ? { km: sp.km, nodes: sp.nodes } : { km: Infinity, nodes: [] }
      if (routeCache.size > 30000) routeCache.clear()
      routeCache.set(key, base)
    }
    if (!Number.isFinite(base.km)) return { km: Infinity, nodes: [], pts: [] }
    // 站台自身到基准站节点的吸附偏移（二十几米量级）
    const na = NET.nodes[aNode]
    const nb = NET.nodes[bNode]
    const off = (Math.hypot(a0.x - na.x, a0.y - na.y) + Math.hypot(b0.x - nb.x, b0.y - nb.y)) / UNITS_PER_KM
    return { km: base.km + off, nodes: base.nodes }
  }

  // 引擎用：节点对之间的道路里程（km）
  function distKm(nodeA, nodeB) {
    if (nodeA === nodeB) return 0
    if (nodeA == null || nodeB == null) return Infinity
    return distTable(nodeA)[nodeB]
  }

  const xs = stops.map((s) => s.x)
  const ys = stops.map((s) => s.y)

  return {
    seed,
    size: opts.size || 'standard',
    ratio,
    nodes,
    nodeMap: nodeAt,
    edges,
    edgeMap,
    adj,
    stops,
    stopById: stopByIdMap,
    stopsByNode,
    depot,
    depots,
    lines,
    shortestPath,
    stopRoute,
    distKm,
    // 视野（抽象坐标）
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

// 节点对最短路：{ path: [节点 id], len: 抽象单位长度 }（引擎沿用这个口径）
// 注意返回的是路径数组的**副本**：引擎会把 v.path 当成自己的可变数组（shift 掉已过的节点），
// 直接给出缓存里的数组会把缓存改坏，后续同一个查询就会拿到空路径。
export function shortestPath(fromNodeId, toNodeId) {
  const r = netShortest(fromNodeId, toNodeId)
  if (!r) return null
  return { path: r.nodes.slice(), len: r.km * UNITS_PER_KM, km: r.km }
}

// 车辆沿路径定位：返回路径上距起点 s（抽象单位）处的坐标
export function pointOnPath(map, nodePath, s) {
  let left = s
  for (let i = 0; i < nodePath.length - 1; i++) {
    const e = map.edgeMap.get(nodePath[i] + '|' + nodePath[i + 1])
    if (!e) continue
    const pts = e.pts
    for (let k = 0; k < pts.length - 1; k++) {
      const seg = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1])
      if (left <= seg) {
        const t = seg ? left / seg : 0
        return { x: pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, y: pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t }
      }
      left -= seg
    }
  }
  const last = map.nodeMap.get(nodePath[nodePath.length - 1])
  return last ? { x: last.x, y: last.y } : { x: 0, y: 0 }
}

export function pathLength(map, nodePath) {
  let sum = 0
  for (let i = 0; i < nodePath.length - 1; i++) {
    const e = map.edgeMap.get(nodePath[i] + '|' + nodePath[i + 1])
    sum += e ? e.len : 0
  }
  return sum
}

// 路径的完整折线（抽象坐标），用于地图渲染
export function pathPolyline(map, nodePath) {
  const out = []
  for (let i = 0; i < nodePath.length - 1; i++) {
    const e = map.edgeMap.get(nodePath[i] + '|' + nodePath[i + 1])
    if (!e) continue
    for (const p of e.pts) {
      const last = out[out.length - 1]
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.01) out.push(p)
    }
  }
  if (out.length === 0) {
    const n = map.nodeMap.get(nodePath[0])
    if (n) out.push([n.x, n.y])
  }
  return out
}

// 路径总里程（km，真实道路口径）
export function pathKm(map, nodePath) {
  let sum = 0
  for (let i = 0; i < nodePath.length - 1; i++) {
    const e = map.edgeMap.get(nodePath[i] + '|' + nodePath[i + 1])
    sum += e ? e.km : 0
  }
  return sum
}

// 路网规模（调试/验收用）
export const NET_STATS = {
  nodes: NET.nodes.length,
  links: NET.adj.reduce((s, x) => s + x.length, 0) / 2,
  roads: DRIVE_EDGES.length,
}

export { UNITS_PER_KM }
