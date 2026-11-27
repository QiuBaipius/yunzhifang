// 算法仿真系统 · 仿真引擎（无头，可在 Node 中直接运行）
//
// 车辆沿真实道路行驶，需求由「分站点 × 分时段」模型生成（core/demand.js），
// 派单复用 services/dispatch.js（与线上算法同一套规则）。
//
// 相对上一版的调度增强：
//   1) 车场：两条线路各一座（map.depots，X1 凌水客运站 / X2 和光大厦），
//      车队按线路分别投放，增派车辆只从本线路车场出车；
//   2) 阈值增派：匹配车辆到上车点 > thresholdMin（默认 10 分钟）时，从车场加派新车，
//      并按「新车 ETA vs 原车 ETA」取更小者；
//   3) 自动减派：增派车辆连续空驶超过 retireIdleMin 即回场停驶；
//   4) 需求预测引导：按未来 rebalanceHorizonMin 的需求（Little 定律 L = λ·W）与周边供给，
//      把空闲车辆引导到「供小于需」的站点，并在每次重算时重新分配目标，避免多车扎堆同一站；
//   5) 全天记录：逐分钟采样车辆位置与接单流水，供宏观视角多倍速回溯。
import { DEMAND, DISPATCH, FLEET, UNITS_PER_KM, VEHICLE } from '../data/config.js'
import { insertOrder } from '../services/dispatch.js'
import { makeRng, pathLength, pathPolyline, pointOnPath } from './gen.js'
import { fare } from '../services/pricing.js'
import { costFormula, fleetCost, vehicleDailyCost } from './cost.js'

const SPEED_KMH = DISPATCH.avgSpeedKmh
const SPEED_KM_PER_MIN = SPEED_KMH / 60
const SPEED_UNITS_PER_MIN = SPEED_KM_PER_MIN * UNITS_PER_KM

// 只给总车数时，按两条线路的站点规模（X1 约 2 倍于 X2）拆分投放
function splitFleet(total) {
  const n = Math.max(0, Math.floor(total || 0))
  if (n <= 0) return {}
  if (n === 1) return { X1: 1 }
  const n1 = Math.max(1, Math.min(n - 1, Math.round((n * 2) / 3)))
  return { X1: n1, X2: n - n1 }
}

function poisson(lambda, rng) {
  if (lambda <= 0) return 0
  if (lambda > 8) return Math.max(0, Math.round(lambda + (rng() - 0.5) * Math.sqrt(lambda) * 2))
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return k - 1
}

export class SimEngine {
  constructor({
    map,
    vehicleCount = 6,
    vehicleCounts = null,
    demandPerMin = 1.2,
    seats = VEHICLE.seats,
    capacity = VEHICLE.capacity,
    seed = 1,
    startTime = DEMAND.windowStart,
    endTime = DEMAND.windowEnd,
    demand = null,
    demandScale = 1,
    thresholdMin = DISPATCH.addVehicleEtaMin,
    autoFleet = true,
    rebalanceOn = true,
    record = false,
    sampleEvery = 1,
    startAtDepot = false,
    detourRatio = DISPATCH.detourMileageRatio,
    waitMaxMin = DISPATCH.maxWaitMin,
    poolLocalSearch = true,
  }) {
    this.map = map
    this.rng = makeRng(seed)
    // 两条线路分别投放：{ X1: n, X2: m }；只给总数时按站点规模拆分
    this.vehicleCounts = vehicleCounts
      ? Object.fromEntries(map.lines.map((l) => [l.id, Math.max(0, Math.floor(vehicleCounts[l.id] || 0))]))
      : splitFleet(vehicleCount)
    this.vehicleCount = Object.values(this.vehicleCounts).reduce((s, n) => s + n, 0)
    this.demandPerMin = demandPerMin
    this.seats = seats
    this.capacity = capacity
    this.startTime = startTime
    this.endTime = endTime
    this.time = startTime
    this.demand = demand
    this.demandScale = demandScale
    this.thresholdMin = thresholdMin
    this.autoFleet = autoFleet
    this.rebalanceOn = rebalanceOn
    this.recordOn = record
    this.sampleEvery = Math.max(0.25, sampleEvery)
    this.startAtDepot = startAtDepot
    this.detourRatio = detourRatio
    this.waitMaxMin = waitMaxMin
    this.poolLocalSearch = poolLocalSearch

    this.orders = []
    this.orderById = new Map()
    this.unreasonable = []
    this.feed = []
    this.fleetEvents = []
    this.seq = 0
    this.distCache = new Map()

    this.vehicles = []
    this.parked = []
    this.retired = []
    this.extraCount = 0
    this.vehicleSeq = 0
    this.lineSeq = {}
    this.lastRebalance = -Infinity
    this.lastFleetAdd = -Infinity

    this.tracks = {}
    this.lastSampleT = -Infinity

    // 运营区 → 站点清单（初次投放、空驶巡游都只在本线路运营区内选点）
    this.stopsOfArea = new Map()
    for (const line of this.map.lines) {
      this.stopsOfArea.set(
        line.areaId,
        this.map.stops.filter((s) => (s.areaIds || [s.areaId]).includes(line.areaId)),
      )
    }

    // 初始车队：按线路分别从各自车场出车
    for (const line of this.map.lines) {
      const n = this.vehicleCounts[line.id] || 0
      if (!n) continue
      const depot = startAtDepot ? this.depotOfLine(line.id) : null
      const pool = this.stopsOfArea.get(line.areaId) || this.map.stops
      for (let i = 0; i < n; i++) {
        const start = depot || pool[Math.floor(this.rng() * pool.length)]
        this.vehicles.push(this.makeVehicle(start, { areaId: line.areaId, lineId: line.id }))
      }
    }
    if (startAtDepot) this.spreadFromDepot()
  }

  // 车场：按线路取（X1 凌水客运站 / X2 和光大厦）
  depotOfLine(lineId) {
    const list = this.map.depots || (this.map.depot ? [this.map.depot] : [])
    return list.find((d) => d.lineId === lineId) || list[0] || null
  }

  depotOfArea(areaId) {
    const line = this.map.lines.find((l) => l.areaId === areaId)
    return this.depotOfLine(line?.id) || this.map.depots?.[0] || null
  }

  makeVehicle(stop, { added = false, areaId = null, lineId = null } = {}) {
    const i = this.vehicleSeq++
    // 车辆归属：优先用显式线路，否则按投放站点所属运营区（a1 → X1，a2 → X2）
    const aid = areaId || stop.areaId || 'a1'
    const line =
      this.map.lines.find((l) => l.id === lineId) ||
      this.map.lines.find((l) => l.areaId === aid) ||
      this.map.lines[i % this.map.lines.length]
    const lid = line?.id || 'X1'
    const no = (this.lineSeq[lid] = (this.lineSeq[lid] || 0) + 1)
    const v = {
      id: 'sv' + (i + 1),
      plate: `${lid}-${String(no).padStart(2, '0')}`,
      lineId: lid,
      x: stop.x,
      y: stop.y,
      node: stop.nodeId,
      path: [],
      s: 0,
      target: null,
      state: 'cruise', // cruise | to_pickup | onboard | to_depot | parked（展示用）
      status: 'idle', // idle | to_pickup | onboard | resting（派单占用语义，与线上一致）
      riders: [],
      plan: [], // 服务事件序列：{ orderId, type: 'pickup'|'dropoff', stopId }
      seats: this.seats,
      capacity: this.capacity,
      onboard: 0,
      areaId: aid,
      order: null,
      km: 0,
      startedAt: this.time,
      workEnd: null,
      added,
      addReason: null,
      rebalanceTarget: null,
      lastRetargetAt: -Infinity,
      idleSince: null,
      journal: [],
      stats: { orders: 0, flagged: 0, paxKm: 0, emptyKm: 0, served: 0 },
    }
    return v
  }

  // 初始车队从各自车场出发，按「未来一小时需求量」把本线路的车分散投放到不同站点
  spreadFromDepot() {
    for (const line of this.map.lines) {
      const vs = this.vehicles.filter((v) => v.lineId === line.id)
      if (!vs.length) continue
      const rank = [...(this.stopsOfArea.get(line.areaId) || this.map.stops)]
      if (this.demand) {
        rank.sort(
          (a, b) =>
            this.demand.expectedCalls(b.id, this.time, 60) - this.demand.expectedCalls(a.id, this.time, 60),
        )
      }
      vs.forEach((v, i) => {
        const stop = rank[i % rank.length]
        this.replan(v, stop.nodeId)
        v.target = stop
        v.rebalanceTarget = stop.id
        v.lastRetargetAt = this.time
      })
    }
  }

  // ---- 图距离工具 ----
  nodeOfVehicle(v) {
    return v.path.length ? v.path[0] : v.node
  }

  graphDistKm(nodeA, nodeB) {
    if (nodeA === nodeB) return 0
    const key = `${nodeA}>${nodeB}`
    const cached = this.distCache.get(key)
    if (cached !== undefined) return cached
    // 地图给了单源全图距离表就用它（一次 Dijkstra 供整批查询），否则退回逐对最短路
    const km = this.map.distKm
      ? this.map.distKm(nodeA, nodeB)
      : (() => {
          const sp = this.map.shortestPath(nodeA, nodeB)
          return sp ? sp.len / UNITS_PER_KM : Infinity
        })()
    this.distCache.set(key, km)
    this.distCache.set(`${nodeB}>${nodeA}`, km)
    return km
  }

  // selectBestVehicle 的 kmFn：支持车辆对象与站点对象
  kmFn = (a, b) => {
    const na = a.path !== undefined ? this.nodeOfVehicle(a) : a.nodeId
    const nb = b.nodeId
    return this.graphDistKm(na, nb)
  }

  // 换目标/换路径时保持位置连续
  //
  // 车辆若正处在某路段中间（v.s > 0），直接 shortestPath(当前节点) 会让 path[0] 回到
  // 刚离开的那个路口，下一帧 pointOnPath(s=0) 就把车「拉回」路口 —— 表现为瞬移。
  // 正确做法是保留当前段 (path[0] → path[1]) 与段内进度 s，只替换 path[1] 之后的部分。
  replan(v, toNodeId) {
    const path = v.path
    if (path.length >= 2 && v.s > 0.001) {
      const nextNode = path[1]
      const sp = this.map.shortestPath(nextNode, toNodeId)
      const tail = sp ? sp.path : [nextNode]
      v.path = [path[0], ...tail]
      return
    }
    const startNode = path.length ? path[0] : v.node
    const sp = this.map.shortestPath(startNode, toNodeId)
    v.path = sp ? sp.path : []
    v.s = 0
  }

  stopOf = (id) => this.map.stopById.get(id)

  nearestStop(v) {
    const pool = this.stopsOfArea.get(v.areaId) || this.map.stops
    let best = null
    let bestD = Infinity
    for (const s of pool) {
      const d = Math.hypot(s.x - v.x, s.y - v.y)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  nearestStopId(v) {
    return this.nearestStop(v)?.id || this.map.stops[0]?.id
  }

  // 从本线路车场到某站点的预计用时（分钟）
  etaFromDepot(stop) {
    const depot = this.depotOfArea(stop.areaId)
    if (!depot) return Infinity
    return this.graphDistKm(depot.nodeId, stop.nodeId) / SPEED_KM_PER_MIN
  }

  // ---- 车场增派 / 减派 ----
  addVehicle({ stop = null, reason = 'eta_threshold', areaId = null } = {}) {
    const depot = this.depotOfArea(areaId || stop?.areaId) || this.map.depots?.[0] || null
    if (!depot) return null
    if (this.extraCount >= FLEET.maxExtra) return null
    const v = this.makeVehicle(depot, { added: true })
    v.addReason = reason
    v.startedAt = this.time
    this.vehicles.push(v)
    this.extraCount++
    if (stop) {
      this.replan(v, stop.nodeId)
      v.target = stop
      v.rebalanceTarget = stop.id
      v.lastRetargetAt = this.time
    }
    this.fleetEvents.unshift({ t: this.time, kind: 'add', vehicleId: v.id, plate: v.plate, reason, target: stop?.name || null })
    if (this.fleetEvents.length > 80) this.fleetEvents.pop()
    return v
  }

  retireVehicle(v, reason = 'surplus') {
    if (v.state === 'to_depot' || v.state === 'parked') return false
    if (v.order || v.riders.length || v.plan.length) return false
    const depot = this.depotOfLine(v.lineId)
    if (!depot) return false
    v.state = 'to_depot'
    v.status = 'resting'
    v.rebalanceTarget = null
    v.idleSince = null
    v.target = { id: depot.id, name: depot.name, x: depot.x, y: depot.y, nodeId: depot.nodeId }
    this.replan(v, depot.nodeId)
    if (this.atNode(v) === depot.nodeId) this.parkVehicle(v, reason)
    return true
  }

  // 增派后插入失败（极少见）：直接抹掉这辆车，不计入当日成本
  discardVehicle(v) {
    this.vehicles = this.vehicles.filter((x) => x !== v)
    this.extraCount = Math.max(0, this.extraCount - 1)
    this.fleetEvents.unshift({ t: this.time, kind: 'discard', vehicleId: v.id, plate: v.plate, reason: 'insert_failed' })
    if (this.fleetEvents.length > 80) this.fleetEvents.pop()
  }

  parkVehicle(v, reason) {
    v.state = 'parked'
    v.status = 'resting'
    v.workEnd = this.time
    v.target = null
    v.path = []
    v.s = 0
    this.parked.push(v)
    this.extraCount = Math.max(0, this.extraCount - 1)
    this.fleetEvents.unshift({ t: this.time, kind: 'retire', vehicleId: v.id, plate: v.plate, reason })
    if (this.fleetEvents.length > 80) this.fleetEvents.pop()
  }

  // ---- 派单：可行插入（算法见 services/ridepool.js）----
  // 返回 { ok, vehicle, events, incKm, incMin, pickupEtaMin, perRider, decision, rejected }
  dispatch(order) {
    const fromStop = this.stopOf(order.fromId)
    // 车辆只在本线运营区内接单：跨区订单交给另一条线路的车队（地铁枢纽两区都可接）
    const fromAreas = fromStop?.areaIds || (fromStop?.areaId ? [fromStop.areaId] : null)
    const pool = this.vehicles.filter(
      (v) =>
        v.status !== 'resting' &&
        v.state !== 'to_depot' &&
        v.state !== 'parked' &&
        (!fromAreas || !v.areaId || fromAreas.includes(v.areaId)),
    )
    const insertOpts = {
      kmFn: this.kmFn,
      stopOf: this.stopOf,
      capacity: this.capacity,
      detourRatio: this.detourRatio,
      waitMaxMin: this.waitMaxMin,
      speedKmPerMin: SPEED_KM_PER_MIN,
      directKmOf: (id) => this.orderById.get(id)?.directKm,
      orderOf: (id) => this.orderById.get(id),
      now: this.time,
      localSearch: this.poolLocalSearch,
    }
    const r = insertOrder(pool, order, insertOpts)
    const best = r.candidates[0] || null
    const bestEta = best ? best.pickupEtaMin : Infinity
    const decision = {
      mode: 'existing',
      thresholdMin: this.thresholdMin,
      etaOriginal: best ? bestEta : null,
      etaNew: null,
      replacedVehicleId: null,
      feasible: r.feasible,
      poolSize: r.poolSize,
      evaluated: r.evaluated,
    }

    // 阈值增派：原匹配车辆到上车点超过阈值 → 立刻从车场派新车；谁 ETA 更小用谁
    if (this.autoFleet && bestEta > this.thresholdMin && this.extraCount < FLEET.maxExtra) {
      const etaNew = this.etaFromDepot(fromStop)
      decision.etaNew = etaNew
      if (etaNew < bestEta && etaNew <= this.waitMaxMin) {
        const v = this.addVehicle({ stop: null, reason: 'eta_threshold', areaId: fromStop?.areaId || null })
        if (v) {
          const r2 = insertOrder([v], order, insertOpts)
          const c2 = r2.candidates[0]
          if (c2) {
            decision.mode = 'depot'
            decision.replacedVehicleId = best?.v.id ?? null
            return { ...c2, ok: true, vehicle: c2.v, decision, rejected: r.rejected, added: true }
          }
          this.discardVehicle(v)
        }
      }
    }

    if (!best) {
      return { ok: false, reason: r.reason || 'no_vehicle', rejected: r.rejected, decision, evaluated: r.evaluated }
    }
    if (bestEta > this.waitMaxMin) {
      return { ok: false, reason: 'wait_too_long', pickupEtaMin: bestEta, rejected: r.rejected, decision, evaluated: r.evaluated }
    }
    return { ...best, ok: true, vehicle: best.v, decision, rejected: r.rejected }
  }

  // 司机视角：判断本次接单是否「不合理」（规则允许但体验存疑）
  // 绕行基准改为「每一位乘客各自的 OD 最优路径距离」，由插入算法统一给出
  assessOrder(v, fromStop, toStop, order, res) {
    const flags = []
    const pickupKm = res.pickupEtaMin * SPEED_KM_PER_MIN
    const eta = res.pickupEtaMin
    // 「接单距离远」是司机体感最差的一类：单独一条标记，司机视角按它优先排序
    if (eta >= DISPATCH.farPickupMin) {
      flags.push({
        kind: 'far',
        text: `接单距离远：距上车点 ${pickupKm.toFixed(2)} km，预计 ${eta.toFixed(0)} 分钟才能到`,
        value: eta,
        km: pickupKm,
        order: 0,
      })
    }
    const beta = this.detourRatio
    const worst = [...(res.perRider || [])].sort((a, b) => b.ratio - a.ratio)[0]
    if (worst && worst.ratio >= 1 + beta * 0.75 - 1e-9) {
      const who = worst.orderId === order.id ? '本单乘客' : `车上乘客 ${worst.orderId}`
      flags.push({
        kind: 'detour',
        text: `拼车后${who}预计乘车 ${worst.plannedKm.toFixed(2)} km，是其 OD 最优路径 ${worst.directKm.toFixed(2)} km 的 ${(
          worst.ratio * 100
        ).toFixed(0)}%（上限 ${((1 + beta) * 100).toFixed(0)}%）`,
        value: worst.ratio,
        riderOrderId: worst.orderId,
        plannedKm: worst.plannedKm,
        directKm: worst.directKm,
      })
    }
    if (v.onboard >= v.seats) {
      flags.push({ kind: 'crowd', text: `接单时车上已 ${v.onboard} 人（座位 ${v.seats}），新乘客可能无座`, value: v.onboard })
    }
    return flags
  }

  // ---- 需求与派单 ----
  // 兼容旧路径：无需求模型时的泊松随机呼叫
  spawnCall() {
    const bothStops = this.map.stops.filter((s) => s.type === 'both')
    const from = bothStops[Math.floor(this.rng() * bothStops.length)]
    let to = this.map.stops[Math.floor(this.rng() * this.map.stops.length)]
    let guard = 0
    while (to.id === from.id && guard++ < 20) {
      to = this.map.stops[Math.floor(this.rng() * this.map.stops.length)]
    }
    if (to.id === from.id) return null
    return this.createCall(from, to)
  }

  // 分站点 × 分时段需求抽样：每个站点各自的泊松过程
  spawnCalls(dtMin) {
    if (this.time > this.endTime) return
    if (!this.demand) {
      const n = poisson(this.demandPerMin * dtMin, this.rng)
      for (let i = 0; i < n; i++) this.spawnCall()
      return
    }
    const rates = this.demand.ratesAt(this.time)
    const distFn = (a, b) => this.graphDistKm(a.nodeId, b.nodeId)
    for (let i = 0; i < this.map.stops.length; i++) {
      const lam = rates[i] * this.demandScale * dtMin
      if (lam <= 0) continue
      const n = poisson(lam, this.rng)
      for (let k = 0; k < n; k++) {
        const from = this.map.stops[i]
        const to = this.demand.pickDestination(from, this.time, this.rng, distFn)
        if (to) this.createCall(from, to)
      }
    }
  }

  // 用户视角：手动发起呼叫
  userCall(fromId, toId) {
    const from = this.stopOf(fromId)
    const to = this.stopOf(toId)
    if (!from || !to || from.id === to.id) return null
    return this.createCall(from, to)
  }

  createCall(from, to) {
    // 乘客 OD 的距离基准：路网**最优路径**（最短路）里程，不是直线距离
    const odKm = this.map.stopRoute(from.id, to.id).km
    const order = {
      id: 'S' + String(++this.seq).padStart(4, '0'),
      fromId: from.id,
      toId: to.id,
      fromName: from.name,
      toName: to.name,
      callTime: this.time,
      status: 'calling',
      vehicleId: null,
      matchTime: null,
      pickupEtaMin: null,
      pickupKm: null,
      boardTime: null,
      doneTime: null,
      actualWaitMin: null,
      rideMin: null,
      odKm,
      directKm: odKm, // 该乘客 OD 的最优路径里程（拼车预算的基准）
      fare: fare(odKm),
      rejectReason: null,
      flags: [],
      dispatchMode: null,
      etaOriginal: null,
      etaNew: null,
      insertion: null,
    }
    this.orders.push(order)
    this.orderById.set(order.id, order)

    const res = this.dispatch(order)
    order.dispatchMode = res.decision?.mode || null
    order.etaOriginal = res.decision?.etaOriginal ?? null
    order.etaNew = res.decision?.etaNew ?? null
    if (!res.ok) {
      order.status = 'rejected'
      order.rejectReason = res.reason
      this.feed.unshift({ t: this.time, kind: 'reject', order, reason: res.reason })
      if (this.feed.length > 60) this.feed.pop()
      return order
    }
    const v = res.vehicle
    // 接单前的现场快照：司机视角复盘用（车辆原路线 / 原定目的地 / 当时位置）
    const beforePath = pathPolyline(this.map, v.path).map(([x, y]) => ({ x, y }))
    const beforeTarget = v.target ? { name: v.target.name, x: v.target.x, y: v.target.y } : null
    const beforePos = { x: v.x, y: v.y }
    const pickupKm = res.pickupEtaMin * SPEED_KM_PER_MIN

    // 受影响最大的那位乘客（可能是车上乘客、已接单未上车乘客，或本单乘客）
    const worst = [...(res.perRider || [])].sort((a, b) => b.ratio - a.ratio)[0] || null
    const worstOrder = worst ? this.orderById.get(worst.orderId) : null
    const detour = worst
      ? {
          incKm: worst.extraKm,
          incMin: worst.extraKm / SPEED_KM_PER_MIN,
          firstOdKm: worst.directKm,
          firstOdMin: worst.directKm / SPEED_KM_PER_MIN,
          plannedKm: worst.plannedKm,
          ratio: worst.ratio,
          firstFrom: worstOrder ? this.stopOf(worstOrder.fromId) : from,
          firstTo: worstOrder ? this.stopOf(worstOrder.toId) : to,
          riderOrderId: worst.orderId,
        }
      : null

    order.status = 'assigned'
    order.vehicleId = v.id
    order.matchTime = this.time
    order.pickupEtaMin = res.pickupEtaMin
    order.pickupKm = pickupKm
    order.flags = this.assessOrder(v, from, to, order, res)
    order.insertion = {
      incKm: res.incKm,
      incMin: res.incMin,
      perRider: res.perRider || [],
      evaluated: res.decision?.evaluated ?? null,
      feasibleVehicles: res.decision?.feasible ?? null,
      positions: res.events.map((e) => `${e.type === 'pickup' ? '上' : '下'}${e.stopId}`),
    }

    // 把新订单插入车辆的多站行程，由 syncVehicle 统一刷新目标/状态
    v.plan = res.events
    v.rebalanceTarget = null
    v.idleSince = null

    // 车辆当日接单流水（宏观回放用）
    v.journal.push({
      orderId: order.id,
      t: this.time,
      fromId: from.id,
      toId: to.id,
      fromName: from.name,
      toName: to.name,
      etaMin: res.pickupEtaMin,
      pickupKm,
      waitMin: null,
      boardTime: null,
      doneTime: null,
      rideMin: null,
      odKm: order.odKm,
      revenue: order.fare,
      flags: order.flags.map((f) => f.kind),
      dispatchMode: order.dispatchMode,
    })

    this.syncVehicle(v)

    // 订单证据：地图复盘时按此还原「原路线 → 新乘客 → 改道后的接驾路线」
    order.evidence = {
      vehicleId: v.id,
      plate: v.plate,
      beforePath,
      beforeTarget,
      beforePos,
      pickupPos: { x: from.x, y: from.y, name: from.name },
      destPos: { x: to.x, y: to.y, name: to.name },
      afterPath: pathPolyline(this.map, v.path).map(([x, y]) => ({ x, y })),
      detour,
      insertion: order.insertion,
      flags: order.flags,
      t: this.time,
      dispatch: res.decision
        ? {
            mode: res.decision.mode,
            thresholdMin: res.decision.thresholdMin,
            etaOriginal: res.decision.etaOriginal,
            etaNew: res.decision.etaNew,
            replacedVehicleId: res.decision.replacedVehicleId,
            pickupKm,
          }
        : null,
    }
    if (order.flags.length) {
      v.stats.flagged++
      this.unreasonable.unshift({
        orderId: order.id,
        vehicleId: v.id,
        plate: v.plate,
        od: `${from.name} → ${to.name}`,
        t: this.time,
        fromName: from.name,
        toName: to.name,
        pickupKm,
        etaMin: res.pickupEtaMin,
        flags: order.flags,
        evidence: order.evidence,
      })
      if (this.unreasonable.length > 120) this.unreasonable.pop()
    }
    this.feed.unshift({ t: this.time, kind: 'match', order, vehicleId: v.id, eta: res.pickupEtaMin })
    if (this.feed.length > 60) this.feed.pop()
    return order
  }

  // ---- 需求预测引导：把空闲车辆分配到「供小于需」的站点 ----
  rebalance(force = false) {
    if (!this.rebalanceOn || !this.demand) return
    if (!force && this.time - this.lastRebalance < FLEET.rebalanceIntervalMin) return
    this.lastRebalance = this.time

    const stops = this.map.stops
    const horizon = FLEET.rebalanceHorizonMin
    const need = new Map()
    for (const s of stops) {
      const lambda = this.demand.expectedCalls(s.id, this.time, horizon) / horizon // 单/分钟
      // Little 定律：站点需要的在途/在站车辆数 ≈ 到达率 × 平均每单占用时间
      need.set(s.id, Math.min(5, lambda * FLEET.serviceTimeMin))
    }

    const supply = new Map(stops.map((s) => [s.id, 0]))
    const idle = []
    for (const v of this.vehicles) {
      const isIdle = v.status === 'idle' && !v.riders.length && !v.plan.length && v.state !== 'to_depot'
      if (isIdle) {
        const sid = v.rebalanceTarget && supply.has(v.rebalanceTarget) ? v.rebalanceTarget : this.nearestStopId(v)
        supply.set(sid, (supply.get(sid) || 0) + 1)
        idle.push(v)
      } else if (v.target && supply.has(v.target.id)) {
        supply.set(v.target.id, supply.get(v.target.id) + 1)
      }
    }

    const deficits = stops
      .map((s) => ({ stop: s, gap: (need.get(s.id) || 0) - (supply.get(s.id) || 0) }))
      .filter((x) => x.gap > FLEET.minDeficit)
      .sort((a, b) => b.gap - a.gap)

    if (!deficits.length) return

    const used = new Set()
    for (const { stop, gap } of deficits) {
      const want = Math.max(1, Math.ceil(gap))
      const cands = idle
        .filter((v) => !used.has(v.id))
        // 两条线路各自独立运营：只在本线路运营区内引导车辆
        .filter((v) => (stop.areaIds || [stop.areaId]).includes(v.areaId))
        .map((v) => ({ v, km: this.graphDistKm(this.nodeOfVehicle(v), stop.nodeId) }))
        .filter((c) => c.km <= FLEET.maxRepositionKm)
        .sort((a, b) => a.km - b.km)
      let k = 0
      for (const c of cands) {
        if (k >= want) break
        const v = c.v
        if (v.rebalanceTarget === stop.id) {
          used.add(v.id)
          k++
          continue
        }
        // 刚改过目标的车辆先观察一个间隔，避免在几个站点之间来回摆
        if (v.rebalanceTarget && this.time - (v.lastRetargetAt || 0) < FLEET.retargetMinGapMin) continue
        this.retarget(v, stop)
        used.add(v.id)
        k++
      }
      // 没有空车可调且缺口明显 → 从车场主动增派（自动加车）
      if (k < want && this.autoFleet && gap >= FLEET.proactiveAddDeficit && this.time - this.lastFleetAdd >= 5) {
        const v = this.addVehicle({ stop, reason: 'demand_gap', areaId: stop.areaId || null })
        if (v) this.lastFleetAdd = this.time
      }
    }
  }

  retarget(v, stop) {
    v.rebalanceTarget = stop.id
    v.lastRetargetAt = this.time
    v.idleSince = null
    v.plan = []
    v.state = 'cruise'
    v.status = 'idle'
    this.replan(v, stop.nodeId)
    v.target = stop
    v.dwellUntil = 0
  }

  // ---- 主循环 ----
  step(dtMin) {
    this.time += dtMin
    this.spawnCalls(dtMin)
    this.rebalance()
    for (const v of this.vehicles) this.moveVehicle(v, dtMin)
    this.updateIdleTimers()
    this.cleanupParked()
    this.recordSample()
  }

  updateIdleTimers() {
    for (const v of this.vehicles) {
      if (v.state === 'to_depot' || v.state === 'parked') continue
      if (!v.added) continue
      if (v.status === 'idle' && !v.riders.length && !v.order) {
        if (v.idleSince == null) v.idleSince = this.time
        else if (this.time - v.idleSince >= FLEET.retireIdleMin) this.retireVehicle(v, 'surplus')
      } else {
        v.idleSince = null
      }
    }
  }

  cleanupParked() {
    if (!this.parked.length) return
    const gone = new Set(this.parked)
    this.vehicles = this.vehicles.filter((v) => !gone.has(v))
    this.retired.push(...this.parked)
    this.parked = []
  }

  moveVehicle(v, dtMin) {
    if (v.state === 'parked') return
    // 空驶车辆到站后驻留一段时间（响应式公交在站点候单）
    if (v.state === 'cruise' && !v.path.length && this.time < (v.dwellUntil || 0)) return
    let left = SPEED_UNITS_PER_MIN * dtMin
    while (left > 0) {
      if (!v.path.length) {
        this.onArrive(v)
        if (!v.path.length) return // 已停下（无目标）
        continue
      }
      const segLen = pathLength(this.map, v.path.slice(0, 2))
      if (v.s + left < segLen) {
        v.s += left
        left = 0
      } else {
        left -= segLen - v.s
        // 记录车辆已通过的节点：路径清空后重新规划必须以「当前所在节点」为起点，
        // 否则会从初始投放点起算，车辆瞬移回原位
        v.node = v.path.shift()
        v.s = 0
      }
    }
    const p = v.path.length ? pointOnPath(this.map, v.path, v.s) : { x: v.x, y: v.y }
    const moved = Math.hypot(p.x - v.x, p.y - v.y)
    v.km += moved / UNITS_PER_KM
    if (v.onboard === 0) v.stats.emptyKm += moved / UNITS_PER_KM
    v.x = p.x
    v.y = p.y
  }

  // 车辆「此刻恰好停在哪个节点」：行驶在路段中间时为 null。
  // 注意不能用 nodeOfVehicle（那是车辆正在前往的下一个节点），否则会在半路「瞬移上车」。
  atNode(v) {
    if (!v.path.length) return v.node
    return v.s <= 1e-6 ? v.path[0] : null
  }

  // ---- 行程推进：按服务事件序列（pickup / dropoff）执行 ----
  // 依据 v.plan 的首个事件刷新目标与状态；车辆已停在该站时立即服务
  syncVehicle(v) {
    if (!v.plan.length) {
      this.goIdle(v)
      return
    }
    const ev = v.plan[0]
    const stop = this.stopOf(ev.stopId)
    if (!stop) {
      v.plan = []
      this.goIdle(v)
      return
    }
    v.target = stop
    v.state = v.onboard > 0 ? 'onboard' : ev.type === 'pickup' ? 'to_pickup' : 'onboard'
    v.status = v.onboard > 0 ? 'onboard' : 'to_pickup'
    const nextPickup = v.plan.find((e) => e.type === 'pickup')
    v.order = nextPickup ? this.orderById.get(nextPickup.orderId) || null : null
    if (this.atNode(v) === stop.nodeId) {
      this.serveAtNode(v)
      return
    }
    this.replan(v, stop.nodeId)
  }

  // 处理当前节点上的所有事件（同一站可能有多人上车/下车）
  serveAtNode(v) {
    const node = this.atNode(v)
    if (node == null) return
    let guard = 0
    while (v.plan.length && guard++ < 80) {
      const ev = v.plan[0]
      const stop = this.stopOf(ev.stopId)
      if (!stop || stop.nodeId !== node) break
      v.plan.shift()
      if (ev.type === 'pickup') this.boardOrder(v, ev.orderId)
      else this.alightOrder(v, ev.orderId)
    }
    if (!v.plan.length) {
      this.goIdle(v)
      return
    }
    const stop = this.stopOf(v.plan[0].stopId)
    const ev = v.plan[0]
    v.target = stop
    v.state = v.onboard > 0 ? 'onboard' : ev.type === 'pickup' ? 'to_pickup' : 'onboard'
    v.status = v.onboard > 0 ? 'onboard' : 'to_pickup'
    const nextPickup = v.plan.find((e) => e.type === 'pickup')
    v.order = nextPickup ? this.orderById.get(nextPickup.orderId) || null : null
    if (stop) this.replan(v, stop.nodeId)
    v.dwellUntil = 0
  }

  boardOrder(v, orderId) {
    const order = this.orderById.get(orderId)
    if (!order || order.status === 'done' || order.status === 'onboard') return
    order.status = 'onboard'
    order.boardTime = this.time
    order.actualWaitMin = this.time - order.callTime
    order.vehicleId = v.id
    v.riders.push({
      orderId: order.id,
      fromId: order.fromId,
      toId: order.toId,
      boardKm: v.km,
      boardTime: this.time,
    })
    v.onboard = v.riders.length
    v.stats.orders++
    v.stats.served++
    v.stats.waitServed = v.stats.waitServed || []
    v.stats.waitServed.push(order.actualWaitMin)
    const jr = v.journal.find((j) => j.orderId === order.id)
    if (jr) {
      jr.waitMin = order.actualWaitMin
      jr.boardTime = this.time
    }
    this.feed.unshift({ t: this.time, kind: 'board', order, vehicleId: v.id })
    if (this.feed.length > 60) this.feed.pop()
  }

  alightOrder(v, orderId) {
    const i = v.riders.findIndex((r) => r.orderId === orderId)
    const rider = i >= 0 ? v.riders[i] : null
    if (i >= 0) v.riders.splice(i, 1)
    v.onboard = v.riders.length
    const order = this.orderById.get(orderId)
    if (order && order.status !== 'done') {
      order.status = 'done'
      order.doneTime = this.time
      order.rideMin = order.boardTime != null ? this.time - order.boardTime : null
      order.actualRideKm = rider ? Math.max(0, v.km - rider.boardKm) : null
      v.stats.paxKm += order.odKm
      const jr = v.journal.find((j) => j.orderId === orderId)
      if (jr) {
        jr.doneTime = this.time
        jr.rideMin = order.rideMin
      }
    }
  }

  goIdle(v) {
    v.plan = []
    v.order = null
    v.target = null
    v.state = 'cruise'
    v.status = 'idle'
    v.path = []
    v.s = 0
    v.dwellUntil = Math.max(v.dwellUntil || 0, this.time + 1 + this.rng() * 2)
  }

  // 到达路径终点
  onArrive(v) {
    if (v.state === 'to_depot') {
      v.workEnd = this.time
      this.parkVehicle(v, 'surplus')
      return
    }
    if (v.plan.length) {
      this.serveAtNode(v)
      if (v.plan.length) return
    }
    this.cruise(v)
  }

  // 空驶：优先前往「需求预测」分配的目标站点，没有目标时随机巡游
  cruise(v) {
    if (v.rebalanceTarget) {
      const stop = this.stopOf(v.rebalanceTarget)
      if (stop) {
        if (this.nodeOfVehicle(v) === stop.nodeId) {
          v.target = stop
          v.dwellUntil = this.time + 2 + this.rng() * 3
          return
        }
        this.replan(v, stop.nodeId)
        v.target = stop
        return
      }
      v.rebalanceTarget = null
    }
    let stop = null
    const pool = this.stopsOfArea.get(v.areaId) || this.map.stops
    for (let i = 0; i < 6; i++) {
      const cand = pool[Math.floor(this.rng() * pool.length)]
      if (cand && cand.nodeId !== this.nodeOfVehicle(v)) {
        stop = cand
        break
      }
    }
    if (!stop) return
    this.replan(v, stop.nodeId)
    v.target = stop
    v.dwellUntil = this.time + 1 + this.rng() * 3
  }

  // ---- 轨迹记录（全天回溯用）----
  recordSample() {
    if (!this.recordOn) return
    if (this.time - this.lastSampleT < this.sampleEvery) return
    this.lastSampleT = this.time
    for (const v of this.vehicles) this.pushTrack(v)
  }

  pushTrack(v) {
    let tr = this.tracks[v.id]
    if (!tr) {
      tr = []
      this.tracks[v.id] = tr
    }
    const last = tr[tr.length - 1]
    if (last && last.t === this.time) {
      last.x = v.x
      last.y = v.y
      last.st = v.state
      last.n = v.onboard
      return
    }
    tr.push({
      t: this.time,
      x: Math.round(v.x * 100) / 100,
      y: Math.round(v.y * 100) / 100,
      st: v.state,
      n: v.onboard,
      o: v.order?.id || v.riders[0]?.orderId || null,
    })
  }

  trackOf(vehicleId) {
    return this.tracks[vehicleId] || []
  }

  // 某车某时刻的位置（线性插值），回放用
  positionAt(vehicleId, t) {
    const tr = this.trackOf(vehicleId)
    if (!tr.length) return null
    if (t <= tr[0].t) return { ...tr[0] }
    if (t >= tr[tr.length - 1].t) return { ...tr[tr.length - 1] }
    let lo = 0
    let hi = tr.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (tr[mid].t <= t) lo = mid
      else hi = mid
    }
    const a = tr[lo]
    const b = tr[hi]
    const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
    return {
      t,
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      st: a.st,
      n: a.n,
      o: a.o,
    }
  }

  // ---- 运行 ----
  // 同步运行指定模拟时长
  run(durationMin, dtMin = 0.25) {
    const steps = Math.ceil(durationMin / dtMin)
    for (let i = 0; i < steps; i++) this.step(dtMin)
    return this.metrics()
  }

  // 跑完一整个运营日（05:30 — 23:45），返回成本与流水汇总
  runDay(dtMin = 0.5) {
    this.recordOn = true
    let guard = 0
    while (this.time < this.endTime - 1e-6 && guard++ < 40000) {
      this.step(Math.min(dtMin, this.endTime - this.time))
    }
    return this.daySummary()
  }

  // ---- 指标 ----
  metrics() {
    const done = this.orders.filter((o) => o.status === 'done')
    const assigned = this.orders.filter((o) => ['assigned', 'onboard', 'done'].includes(o.status))
    const rejected = this.orders.filter((o) => o.status === 'rejected')
    const waits = assigned.map((o) => o.actualWaitMin ?? o.pickupEtaMin ?? 0).filter((w) => isFinite(w))
    waits.sort((a, b) => a - b)
    const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
    const p = (xs, q) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0)
    const totalEmpty = this.vehicles.reduce((s, v) => s + v.stats.emptyKm, 0)
    const totalPax = this.vehicles.reduce((s, v) => s + v.stats.paxKm, 0)
    const rides = done.map((o) => o.rideMin).filter((x) => x != null)
    return {
      time: this.time,
      elapsedMin: this.time - this.startTime,
      finished: this.time >= this.endTime - 1e-6,
      calls: this.orders.length,
      matched: assigned.length,
      matchRate: this.orders.length ? assigned.length / this.orders.length : 1,
      rejected: rejected.length,
      rejectReasons: rejected.reduce((m, o) => ({ ...m, [o.rejectReason]: (m[o.rejectReason] || 0) + 1 }), {}),
      avgWaitMin: mean(waits),
      p90WaitMin: p(waits, 0.9),
      maxWaitMin: waits.length ? waits[waits.length - 1] : 0,
      avgRideMin: mean(rides),
      paxKm: totalPax,
      emptyKm: totalEmpty,
      utilization: totalPax + totalEmpty > 0 ? totalPax / (totalPax + totalEmpty) : 0,
      unreasonable: this.unreasonable.length,
      flaggedOrders: this.orders.filter((o) => o.flags.length).length,
      farOrders: this.orders.filter((o) => o.flags.some((f) => f.kind === 'far')).length,
      waitAlerts: this.waitAlerts().length,
      vehicles: this.vehicles.length,
      extraVehicles: this.extraCount,
      thresholdMin: this.thresholdMin,
      revenue: assigned.reduce((s, o) => s + (o.fare || 0), 0),
      km: this.vehicles.reduce((s, v) => s + v.km, 0),
    }
  }

  // 用户视角：等待超过阈值（默认 10 分钟）的订单，按等待时长倒序
  waitAlerts(threshold = DISPATCH.userWaitAlertMin) {
    const rows = []
    for (const o of this.orders) {
      if (!['assigned', 'onboard', 'done'].includes(o.status)) continue
      const waitMin = o.actualWaitMin != null ? o.actualWaitMin : o.status === 'assigned' ? this.time - o.callTime : null
      if (waitMin == null || waitMin <= threshold) continue
      rows.push({ ...o, waitMin })
    }
    return rows.sort((a, b) => b.waitMin - a.waitMin)
  }

  // 司机视角：疑似不合理订单（接单距离远优先）
  flaggedOrders(vehicleId = null) {
    const list = vehicleId ? this.unreasonable.filter((u) => u.vehicleId === vehicleId) : this.unreasonable.slice()
    const rank = (u) => (u.flags.some((f) => f.kind === 'far') ? 0 : u.flags.some((f) => f.kind === 'detour') ? 1 : 2)
    return list.sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      const fa = a.flags.find((f) => f.kind === 'far')?.value || 0
      const fb = b.flags.find((f) => f.kind === 'far')?.value || 0
      return fb - fa
    })
  }

  // ---- 全日汇总：每车运行成本 + 接单流水 ----
  daySummary() {
    const dayMin = Math.max(1, this.time - this.startTime)
    const all = [...this.vehicles, ...this.retired]
    const rows = all
      .map((v) => {
        const journal = v.journal || []
        const revenue = journal.reduce((s, j) => s + (j.revenue || 0), 0)
        const workEnd = v.workEnd ?? this.time
        const onDutyMin = Math.max(0, workEnd - v.startedAt)
        const cost = vehicleDailyCost({ km: v.km, onDutyMin, dayMin, orders: journal.length })
        return {
          vehicleId: v.id,
          plate: v.plate,
          added: !!v.added,
          addReason: v.addReason,
          km: v.km,
          emptyKm: v.stats.emptyKm,
          paxKm: v.stats.paxKm,
          orders: journal.length,
          doneOrders: journal.filter((j) => j.doneTime != null).length,
          revenue,
          cost,
          perOrderCost: journal.length ? cost.total / journal.length : null,
          utilization: v.km > 0 ? Math.min(1, v.stats.paxKm / v.km) : 0,
          flagged: v.stats.flagged,
          onDutyMin,
        }
      })
      .sort((a, b) => a.cost.total - b.cost.total)

    const totals = fleetCost(rows)
    return {
      rows,
      totals,
      window: { start: this.startTime, end: this.time, dayMin },
      formula: costFormula(),
      fleetEvents: this.fleetEvents.slice(0, 40),
      orders: this.orders.length,
      journalByVehicle: Object.fromEntries(all.map((v) => [v.id, v.journal || []])),
    }
  }
}
