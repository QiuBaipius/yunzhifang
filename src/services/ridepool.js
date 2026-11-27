// 拼车核心算法：**带服务质量的可行插入（Cheapest Feasible Insertion, CFI）
// + 车辆路径局部重优化（or-opt）**
//
// 这是实时 DRT（需求响应公交）/ ride-pooling 领域公认的在线求解范式：
//   · Psaraftis (1980)：动态 dial-a-ride 的插入式求解；
//   · Jaw et al. (1986)：插入启发式（insertion heuristic）求解 DAR；
//   · Ma, Zheng & Wolfson (2013, T-share)：出租车实时拼车的插入 + 距离/时间约束；
//   · Alonso-Mora et al. (2017, PNAS)：高容量拼车的可行行程图 + 全局分配
//     （其在线高效版本即「对每辆车枚举可行插入，再在候选间取最优」）；
//   · Ropke & Pisinger (2006)：PDPTW 的 ALNS 重优化（离线基准，在线用其局部搜索思想）；
//   · Ho et al. (2018) / Molenbruch et al. (2017)：DRT/DAR 综述与分类。
//
// 相比「只看首位乘客的绕路增量 + 夹角」的规则，本实现的不同点：
//   1) 每辆车的行程被建模为「服务事件序列」（pickup / dropoff），而不是单一目标点；
//   2) 新订单要插入到序列中的最佳位置（先枚举 O(n²) 个 (上车位次, 下车位次)），
//      而不是「先接新客、再送回首位乘客」这一种固定顺序；
//   3) **对车上每一位乘客**（以及所有已接单未上车的乘客）逐一校验其自身的
//      「OD 最优路径距离（路网最短路，不是直线）」的绕行预算，而不是只看第一位；
//   4) 同时校验：容量（逐段载客数）、新乘客等待上限、在途乘客等待上限；
//   5) 插入后再做 or-opt 局部搜索，把每一对 (pickup, dropoff) 挪到更省的位置，
//      消除「按到达顺序贪心插入」的短视。
//
// 复杂度：单车事件数 n ≤ 2×容量（本工程 ≤ 34），枚举插入 O(n²)，每次评估 O(n)，
// 即 O(n³)；典型 n≈8 时约 200 次距离查询，已在 µs~ms 级。
const EPS = 1e-9

export const POOL_DEFAULTS = {
  detourRatio: 1 / 3, // 每位乘客允许的额外里程 = 其 OD 最优路径距离 × 该比例
  waitMaxMin: 20, // 乘客最长等待（含在途乘客被推迟的上车时间）
  speedKmPerMin: 0.5, // 30km/h
  capacity: 17,
  localSearch: true,
  localSearchPasses: 2,
}

// ---- 路线距离 ----
export function planStops(v, events, stopOf) {
  const stops = [v]
  for (const e of events) {
    const s = stopOf(e.stopId)
    if (!s) return null
    stops.push(s)
  }
  return stops
}

// at[k] = 从车辆当前位置到 stops[k] 的累计里程（stops[0] 即车辆，at[0]=0）
function measure(kmFn, stops) {
  const n = stops.length
  const at = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) at[i + 1] = at[i] + kmFn(stops[i], stops[i + 1])
  return { at, total: at[n - 1] || 0 }
}

export function planKm(v, events, kmFn, stopOf) {
  const stops = planStops(v, events, stopOf)
  if (!stops) return Infinity
  return measure(kmFn, stops).total
}

// 事件位次 k 对应的「从当前位置出发的里程」：stops[k+1]
const eventKm = (at, k) => at[k + 1]

// ---- 可行性评估 ----
// 返回 { ok, totalKm, pickupEtaMin, perRider, capacityPeak, reason? }
export function evaluatePlan(v, events, order, ctx) {
  const { kmFn, stopOf, capacity, detourRatio, waitMaxMin, speedKmPerMin, directKmOf } = ctx
  const stops = planStops(v, events, stopOf)
  if (!stops) return { ok: false, reason: 'bad_plan' }
  const { at, total } = measure(kmFn, stops)

  // 1) 容量：逐段载客数（起点是车辆当前已载客数）
  let load = v.onboard || 0
  const peakStart = load
  let peak = load
  const idx = new Map()
  for (let k = 0; k < events.length; k++) {
    const e = events[k]
    const box = idx.get(e.orderId) || {}
    if (e.type === 'pickup') {
      box.pickup = k
      load += 1
    } else {
      box.dropoff = k
      load -= 1
    }
    if (load < 0) return { ok: false, reason: 'bad_plan' }
    peak = Math.max(peak, load)
    idx.set(e.orderId, box)
  }
  if (peak > capacity) return { ok: false, reason: 'capacity', peak }
  if (load !== 0) return { ok: false, reason: 'bad_plan' }

  const onboard = new Set((v.riders || []).map((r) => r.orderId))
  const riderInfo = new Map((v.riders || []).map((r) => [r.orderId, r]))
  const seen = new Set([...onboard, ...events.map((e) => e.orderId)])
  const perRider = []

  // 2) 每一位相关乘客的绕路预算（按各自的 OD 最优路径距离）
  for (const oid of seen) {
    const box = idx.get(oid) || {}
    if (box.dropoff == null) return { ok: false, reason: 'bad_plan' }
    const direct = oid === order.id ? order.directKm : directKmOf(oid)
    if (!(direct > 0) || !isFinite(direct)) return { ok: false, reason: 'bad_plan' }

    let planned
    let traveled = 0
    if (onboard.has(oid)) {
      if (box.pickup != null) return { ok: false, reason: 'bad_plan' }
      const r = riderInfo.get(oid)
      traveled = Math.max(0, (v.km || 0) - (r.boardKm || 0))
      planned = traveled + eventKm(at, box.dropoff)
    } else {
      if (box.pickup == null) return { ok: false, reason: 'bad_plan' }
      planned = eventKm(at, box.dropoff) - eventKm(at, box.pickup)
    }
    if (planned < -EPS) return { ok: false, reason: 'bad_plan' }

    const budget = direct * (1 + detourRatio)
    const ratio = planned / direct
    if (planned > budget + 1e-6) {
      return { ok: false, reason: 'detour_budget', orderId: oid, ratio, planned, direct }
    }
    // 3) 等待上限：尚未上车的乘客（含已有订单与新订单）的**累计等待**
    //    累计等待 = 呼叫至今已等待 + 按新行程还要等多久（只看「还要等多久」会不断把老乘客往后推）
    if (!onboard.has(oid) && box.pickup != null) {
      const waits = eventKm(at, box.pickup) / speedKmPerMin
      const ord = oid === order.id ? order : ctx.orderOf ? ctx.orderOf(oid) : null
      const elapsed = ctx.now != null && ord?.callTime != null ? Math.max(0, ctx.now - ord.callTime) : 0
      const eta = elapsed + waits
      if (eta > waitMaxMin + 1e-6) return { ok: false, reason: 'wait_too_long', orderId: oid, eta }
    }
    perRider.push({
      orderId: oid,
      directKm: direct,
      plannedKm: planned,
      traveledKm: traveled,
      extraKm: planned - direct,
      ratio,
      budgetKm: budget,
    })
  }

  // 4) 新订单自身的等待
  const mine = idx.get(order.id)
  const pickupEtaMin = eventKm(at, mine.pickup) / speedKmPerMin
  if (pickupEtaMin > waitMaxMin + 1e-6) {
    return { ok: false, reason: 'wait_too_long', orderId: order.id, eta: pickupEtaMin }
  }

  return { ok: true, totalKm: total, pickupEtaMin, perRider, capacityPeak: peak, peakStart, idx }
}

// ---- 车辆路径局部重优化：or-opt（成对搬迁 pickup+dropoff）----
export function improvePlan(v, events, order, ctx, passes = ctx.localSearchPasses ?? 2) {
  let best = events
  let bestEval = evaluatePlan(v, events, order, ctx)
  if (!bestEval.ok) return { events, eval: bestEval, improved: false }
  const onboard = new Set((v.riders || []).map((r) => r.orderId))

  for (let pass = 0; pass < passes; pass++) {
    let improved = false
    const ids = [...new Set(best.map((e) => e.orderId))]
    for (const oid of ids) {
      if (onboard.has(oid)) continue // 已上车的上车事件在历史里，无法再挪
      const pick = best.find((e) => e.orderId === oid && e.type === 'pickup')
      const drop = best.find((e) => e.orderId === oid && e.type === 'dropoff')
      if (!pick || !drop) continue
      const rest = best.filter((e) => e.orderId !== oid)
      let local = null
      for (let i = 0; i <= rest.length; i++) {
        for (let j = i + 1; j <= rest.length + 1; j++) {
          const cand = rest.slice()
          cand.splice(i, 0, pick)
          cand.splice(j, 0, drop)
          const ev = evaluatePlan(v, cand, order, ctx)
          if (!ev.ok) continue
          if (!local || ev.totalKm < local.eval.totalKm - 1e-9) local = { events: cand, eval: ev }
        }
      }
      if (local && local.eval.totalKm < bestEval.totalKm - 1e-9) {
        best = local.events
        bestEval = local.eval
        improved = true
      }
    }
    if (!improved) break
  }
  return { events: best, eval: bestEval, improved: best !== events }
}

// ---- 车辆选择：对每辆候选车枚举所有可行插入，取「总里程增加最少」----
// 返回 { ok, candidates:[{v, events, incKm, incMin, pickupEtaMin, perRider, eval}], rejected, reason, evaluated }
export function insertOrder(vehicles, order, opts = {}) {
  const ctx = {
    kmFn: opts.kmFn,
    stopOf: opts.stopOf,
    capacity: opts.capacity ?? POOL_DEFAULTS.capacity,
    detourRatio: opts.detourRatio ?? POOL_DEFAULTS.detourRatio,
    waitMaxMin: opts.waitMaxMin ?? POOL_DEFAULTS.waitMaxMin,
    speedKmPerMin: opts.speedKmPerMin ?? POOL_DEFAULTS.speedKmPerMin,
    directKmOf: opts.directKmOf || (() => Infinity),
    orderOf: opts.orderOf || null,
    now: opts.now ?? null,
    localSearch: opts.localSearch ?? POOL_DEFAULTS.localSearch,
    localSearchPasses: opts.localSearchPasses ?? POOL_DEFAULTS.localSearchPasses,
  }
  if (!order.directKm) order.directKm = order.odKm

  const candidates = []
  const rejected = []
  let evaluated = 0

  for (const v of vehicles) {
    const base = v.plan || []
    if (base.length >= 2 * ctx.capacity) {
      rejected.push({ vehicleId: v.id, reason: 'capacity' })
      continue
    }
    if ((v.onboard || 0) > ctx.capacity) {
      rejected.push({ vehicleId: v.id, reason: 'capacity' })
      continue
    }
    // 先做一个廉价剪枝：空车直接到上车点的等待都要超时，插入不可能可行
    const eta0 = ctx.kmFn(v, ctx.stopOf(order.fromId)) / ctx.speedKmPerMin
    if (eta0 > ctx.waitMaxMin + 1e-6) {
      rejected.push({ vehicleId: v.id, reason: 'wait_too_long', detail: eta0 })
      continue
    }
    const baseKm = planKm(v, base, ctx.kmFn, ctx.stopOf)
    if (!isFinite(baseKm)) {
      rejected.push({ vehicleId: v.id, reason: 'bad_plan' })
      continue
    }

    let best = null
    for (let i = 0; i <= base.length; i++) {
      for (let j = i + 1; j <= base.length + 1; j++) {
        const ev = base.slice()
        ev.splice(i, 0, { orderId: order.id, type: 'pickup', stopId: order.fromId })
        ev.splice(j, 0, { orderId: order.id, type: 'dropoff', stopId: order.toId })
        evaluated++
        const r = evaluatePlan(v, ev, order, ctx)
        if (!r.ok) {
          rejected.push({ vehicleId: v.id, reason: r.reason, orderId: r.orderId, ratio: r.ratio, eta: r.eta })
          continue
        }
        const incKm = r.totalKm - baseKm
        if (!best || incKm < best.incKm - 1e-9) {
          best = { v, events: ev, incKm, incMin: incKm / ctx.speedKmPerMin, ...r }
        }
      }
    }
    if (!best) continue

    // 插入后局部重优化：不改变已上车乘客的上车点，只重排未上车的上下车顺序
    if (ctx.localSearch) {
      const imp = improvePlan(v, best.events, order, ctx)
      if (imp.improved) {
        best = { v, events: imp.events, incKm: imp.eval.totalKm - baseKm, incMin: (imp.eval.totalKm - baseKm) / ctx.speedKmPerMin, ...imp.eval, improved: true }
      }
    }
    candidates.push(best)
  }

  candidates.sort((a, b) => a.incKm - b.incKm || a.pickupEtaMin - b.pickupEtaMin)

  // 拒单原因：优先给出「最接近成功」的那一类，便于统计与解释
  const count = (reason) => rejected.filter((r) => r.reason === reason).length
  let reason = null
  if (!vehicles.length) reason = 'no_vehicle'
  else if (count('detour_budget')) reason = 'detour_budget'
  else if (count('capacity')) reason = 'capacity'
  else if (count('wait_too_long')) reason = 'wait_too_long'
  else if (rejected.length) reason = rejected[0].reason
  else reason = 'no_vehicle'

  return {
    ok: candidates.length > 0,
    candidates,
    rejected,
    reason: candidates.length ? null : reason,
    evaluated,
    feasible: candidates.length,
    poolSize: vehicles.length,
  }
}
