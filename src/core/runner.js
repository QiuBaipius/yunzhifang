// 场景执行器：把一份场景配置跑成结果（GUI 与命令行共用同一套逻辑，保证「所见即所得」）
import { generateMap } from './gen.js'
import { SimEngine } from './engine.js'
import { DemandModel, fmtClock } from './demand.js'
import { readScenario, scenarioSummary } from './scenario.js'

export function runScenario(scenario) {
  const c = readScenario(scenario)
  const map = generateMap({ seed: c.network.seed, size: c.network.size })
  const demand = new DemandModel({ stops: map.stops, settings: c.demand.stops })
  const engine = new SimEngine({
    map,
    vehicleCount: c.fleet.vehicles,
    vehicleCounts: c.fleet.counts,
    seats: c.fleet.seats,
    capacity: c.fleet.capacity,
    demand,
    demandScale: c.demand.scale,
    seed: c.sim.seed,
    startTime: c.sim.start,
    endTime: c.sim.end,
    thresholdMin: c.dispatch.thresholdMin,
    autoFleet: c.fleet.autoFleet,
    rebalanceOn: c.dispatch.rebalanceOn,
    detourRatio: c.dispatch.detourRatio,
    waitMaxMin: c.dispatch.waitMaxMin,
    poolLocalSearch: c.dispatch.poolLocalSearch,
    startAtDepot: true,
    record: c.sim.record,
    sampleEvery: 1,
  })
  const t0 = Date.now()
  const summary = engine.runDay(c.sim.stepMin)
  const kpis = engine.metrics()
  const elapsedMs = Date.now() - t0

  const warnings = []
  const unknown = Object.keys(c.demand.stops || {}).filter((id) => !map.stopById.has(id))
  if (unknown.length) {
    warnings.push(`需求设置中有 ${unknown.length} 个站点 id 不在当前路网里：${unknown.slice(0, 5).join('、')}${unknown.length > 5 ? '…' : ''}`)
  }
  if (summary.totals.revenue < summary.totals.cost) {
    warnings.push('票款收入低于运营成本：这是需求响应公交常见的政策性亏损，可用于核算补贴。')
  }
  if (kpis.matchRate < 0.9) {
    warnings.push(`匹配率只有 ${(kpis.matchRate * 100).toFixed(1)}%，建议增加车辆或放宽绕行预算/最长等待。`)
  }

  return { scenario, config: c, map, demand, engine, summary, kpis, warnings, elapsedMs, label: scenarioSummary(scenario) }
}

// ---------------- 输出表 ----------------
const FLAG_TEXT = { far: '接单距离远', detour: '绕行贴近上限', crowd: '可能无座' }

export function ordersTable({ engine }) {
  return engine.orders.map((o) => ({
    订单号: o.id,
    呼叫时刻: fmtClock(o.callTime),
    状态: o.status === 'done' ? '已完成' : o.status === 'onboard' ? '在车上' : o.status === 'assigned' ? '待上车' : '已拒单',
    起点: o.fromName,
    终点: o.toName,
    'OD最优路径(km)': o.directKm?.toFixed(2) ?? '',
    '一口价(元)': o.fare?.toFixed(2) ?? '',
    车辆: engine.vehicles.find((v) => v.id === o.vehicleId)?.plate || '',
    等待分钟: o.actualWaitMin != null ? o.actualWaitMin.toFixed(1) : o.pickupEtaMin != null ? o.pickupEtaMin.toFixed(1) : '',
    乘车分钟: o.rideMin != null ? o.rideMin.toFixed(1) : '',
    实际乘车km: o.actualRideKm != null ? o.actualRideKm.toFixed(2) : '',
    标记: o.flags.map((f) => FLAG_TEXT[f.kind] || f.kind).join('；'),
    拒单原因: o.rejectReason || '',
    派单方式: o.dispatchMode === 'depot' ? '车场增派' : o.dispatchMode ? '既有车辆' : '',
  }))
}

export function vehiclesTable({ summary }) {
  return summary.rows.map((r) => ({
    车辆: r.plate,
    类型: r.added ? '增派' : '初始',
    里程km: r.km.toFixed(1),
    空驶km: r.emptyKm.toFixed(1),
    订单数: r.orders,
    载客率: `${(r.utilization * 100).toFixed(0)}%`,
    固定成本元: r.cost.fixed.toFixed(0),
    里程成本元: r.cost.variable.toFixed(0),
    日成本元: r.cost.total.toFixed(0),
    单均成本元: r.perOrderCost != null ? r.perOrderCost.toFixed(2) : '',
    收入元: r.revenue.toFixed(0),
    收支差元: (r.revenue - r.cost.total).toFixed(0),
  }))
}

export function trajectoriesTable({ engine }, stride = 1) {
  const rows = []
  for (const veh of [...engine.vehicles, ...engine.retired]) {
    const tr = engine.trackOf(veh.id)
    for (let i = 0; i < tr.length; i += stride) {
      const p = tr[i]
      rows.push({
        车辆: veh.plate,
        时刻: fmtClock(p.t),
        分钟: p.t,
        x: p.x,
        y: p.y,
        状态: p.st === 'onboard' ? '载客' : p.st === 'to_pickup' ? '接客' : p.st === 'to_depot' ? '回场' : '空驶',
        车上人数: p.n,
        订单: p.o || '',
      })
    }
  }
  return rows
}

export function kpisObject({ kpis, summary, elapsedMs, label }) {
  return {
    场景: label,
    仿真耗时秒: +(elapsedMs / 1000).toFixed(2),
    呼叫数: kpis.calls,
    匹配率: +(kpis.matchRate * 100).toFixed(2),
    平均等待分钟: +kpis.avgWaitMin.toFixed(2),
    P90等待分钟: +kpis.p90WaitMin.toFixed(2),
    平均乘车分钟: +kpis.avgRideMin.toFixed(2),
    接单距离远单数: kpis.farOrders,
    '等待>10分钟单数': kpis.waitAlerts,
    疑似不合理单数: kpis.unreasonable,
    拒单数: kpis.rejected,
    拒单原因: kpis.rejectReasons,
    车辆数: summary.totals.vehicles,
    总里程km: +summary.totals.km.toFixed(1),
    总成本元: +summary.totals.cost.toFixed(1),
    车公里成本元: summary.totals.perKm != null ? +summary.totals.perKm.toFixed(3) : null,
    单均成本元: summary.totals.perOrder != null ? +summary.totals.perOrder.toFixed(2) : null,
    票款收入元: +summary.totals.revenue.toFixed(1),
    收支差元: +summary.totals.net.toFixed(1),
  }
}

export function toCsv(rows) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

export function summaryText(result) {
  const { kpis, summary, config, map, warnings } = result
  const lines = []
  lines.push(`场景：${result.label}`)
  lines.push(`路网：${map.stops.length} 站 / ${map.edges.filter((e) => !e.depot).length} 段道路（${map.size}）`)
  lines.push(`窗口：${fmtClock(config.sim.start)} — ${fmtClock(config.sim.end)}，步长 ${config.sim.stepMin} 分钟`)
  lines.push('')
  lines.push(`呼叫 ${kpis.calls} · 匹配率 ${(kpis.matchRate * 100).toFixed(1)}% · 平均等待 ${kpis.avgWaitMin.toFixed(2)} 分钟 · P90 ${kpis.p90WaitMin.toFixed(1)} 分钟`)
  lines.push(`接单距离远 ${kpis.farOrders} 单 · 等待>10 分钟 ${kpis.waitAlerts} 单 · 疑似不合理 ${kpis.unreasonable} 单 · 拒单 ${kpis.rejected}`)
  lines.push(
    `成本：${summary.totals.vehicles} 辆 / ${summary.totals.km.toFixed(0)} km / ¥${summary.totals.cost.toFixed(0)}` +
      `（车公里 ¥${(summary.totals.perKm || 0).toFixed(2)}，单均 ¥${(summary.totals.perOrder || 0).toFixed(2)}）`,
  )
  lines.push(`票款 ¥${summary.totals.revenue.toFixed(0)} · 收支差 ¥${summary.totals.net.toFixed(0)}`)
  if (warnings.length) {
    lines.push('')
    lines.push('提示：')
    for (const w of warnings) lines.push(`  · ${w}`)
  }
  return lines.join('\n')
}
