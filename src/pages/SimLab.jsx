// 算法仿真系统：大连真实路网与站点，从司机视角 / 用户视角 / 宏观视角检验派单算法，
// 并支持分站点分时段需求设置、阈值增派与需求预测引导。
// 派单规则与云乘见线上算法同源同文（services/dispatch.js）。
import { useEffect, useMemo, useState } from 'react'
import SimMap from '../components/SimMap.jsx'
import DemandSettings from '../components/DemandSettings.jsx'
import MacroPanel from '../components/MacroPanel.jsx'
import { generateMap } from '../core/gen.js'
import { SimEngine } from '../core/engine.js'
import { DemandModel, fmtClock } from '../core/demand.js'
import { vehicleDailyCost } from '../core/cost.js'
import { toLngLat } from '../data/geo.js'
import { DISPATCH, INITIAL_FLEET, VEHICLE } from '../data/config.js'

const SPEEDS = [
  { v: 1, label: '1×' },
  { v: 4, label: '4×' },
  { v: 16, label: '16×' },
]

const STATE_LABEL = {
  cruise: '候单 / 赶往需求点',
  to_pickup: '接客中',
  onboard: '载客运行',
  to_depot: '返回车场',
  parked: '已回场',
}

const REASON_TEXT = {
  vehicle_busy: '车辆正在执行其他订单',
  cross_area: '跨区域（本区域无车可派）',
  capacity: '车辆满载或位次不够（不允许超员）',
  detour_budget: '拼车后某位乘客的乘车里程会超过其 OD 最优路径的 133%',
  wait_too_long: `预计等待超过 ${DISPATCH.maxWaitMin} 分钟，系统不派单`,
  no_vehicle: '附近没有可行车辆',
  bad_plan: '行程无解',
}

function fmtMin(v) {
  return `${v.toFixed(1)} 分钟`
}

function pct(d) {
  if (!d || !d.firstOdKm) return '—'
  return `${(d.ratio * 100).toFixed(0)}%`
}

// 把一条「疑似不合理订单」翻译成司机看得懂的话：发生了什么、为什么可疑、规则怎么判的
function describeFlag(u) {
  const d = u.evidence?.detour
  const parts = []
  for (const f of u.flags || []) {
    if (f.kind === 'far') {
      parts.push(
        `这一单司机要从 ${u.etaMin?.toFixed(0)} 分钟车程外赶过去（${u.pickupKm?.toFixed(2)} km），超过了 ${DISPATCH.farPickupMin} 分钟的接驾距离警戒线——路上空跑的时间算在司机头上，是司机体感最差的一类单。`,
      )
    } else if (f.kind === 'detour' && d) {
      const who = d.riderOrderId === u.orderId ? '本单乘客' : `车上乘客 ${d.riderOrderId}`
      parts.push(
        `插入算法把新乘客（${u.evidence.pickupPos.name}）排进 ${u.plate} 的多站行程后，离 133% 上限最近的是${who}：` +
          `预计乘车 ${d.plannedKm?.toFixed(2)} km，其 OD 最优路径 ${d.firstOdKm.toFixed(2)} km，占比 ${pct(d)}。` +
          `系统枚举了 ${u.evidence.insertion?.evaluated ?? '—'} 个插入位次，取「总里程增加最少且每位乘客都不超预算」的方案——这一单已贴近上限，再多一位乘客就会被拒。`,
      )
    } else {
      parts.push(f.text)
    }
  }
  if (u.evidence?.dispatch?.mode === 'depot') {
    const o = u.evidence.dispatch.etaOriginal
    parts.push(
      `触发阈值增派：原匹配车辆要 ${o == null ? '—' : `${o.toFixed(1)} 分钟`} 才能到，超过 ${u.evidence.dispatch.thresholdMin} 分钟阈值，系统从车场派出新车（${u.evidence.dispatch.etaNew.toFixed(1)} 分钟到），由新车接这一单。`,
    )
  }
  if (u.evidence?.beforeTarget) {
    parts.push(`地图上灰虚线是接单前车辆本来的路线（原定前往 ${u.evidence.beforeTarget.name}），橙虚线是插入这条新呼叫后改走的路线。`)
  }
  return parts.join(' ')
}

export default function SimLab() {
  // 路网固定为全部真实站点（不再提供「随机种子 / 地图规模」调节）
  const seed = 20261022
  // 两条线路分别投放车辆
  const [fleet, setFleet] = useState({ ...INITIAL_FLEET })
  const [demandScale, setDemandScale] = useState(1)
  const [speed, setSpeed] = useState(4)
  const [running, setRunning] = useState(true)
  // 打开系统先看「需求与调度」，由用户自己切到司机视角
  const [tab, setTab] = useState('demand')
  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [focusOrder, setFocusOrder] = useState(null) // 司机视角：选中的疑似不合理订单（地图复盘）
  const [call, setCall] = useState({ fromId: '', toId: '' })
  const [callResult, setCallResult] = useState(null)
  const [thresholdMin, setThresholdMin] = useState(DISPATCH.addVehicleEtaMin)
  const [autoFleet, setAutoFleet] = useState(true)
  const [rebalanceOn, setRebalanceOn] = useState(true)
  const [detourRatio, setDetourRatio] = useState(DISPATCH.detourMileageRatio)
  const [waitMaxMin, setWaitMaxMin] = useState(DISPATCH.maxWaitMin)
  const [stopSettings, setStopSettings] = useState({})
  const [day, setDay] = useState(null) // runScenario 结果：{ config, engine, summary, kpis, warnings, label }
  const [replay, setReplay] = useState(null) // { vehicleId, t, playing, speed }
  const [runKey, setRunKey] = useState(0) // 全天跑完后重跑用的引擎版本号
  const [, forceRender] = useState(0)

  const map = useMemo(() => generateMap({ seed, size: 'large' }), [seed])
  const demand = useMemo(() => new DemandModel({ stops: map.stops, settings: stopSettings }), [map, stopSettings])
  const engine = useMemo(
    () =>
      new SimEngine({
        map,
        vehicleCounts: fleet,
        demand,
        seed: (seed % 100000) + 1,
        startAtDepot: true,
        record: false,
      }),
    // 需求/调度参数变化时通过下面的 effect 同步，避免每次调参都把仿真重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, fleet.X1, fleet.X2, seed, runKey],
  )

  // 参数同步（不重置正在跑的仿真）
  useEffect(() => {
    engine.demand = demand
  }, [engine, demand])
  useEffect(() => {
    engine.demandScale = demandScale
    engine.thresholdMin = thresholdMin
    engine.autoFleet = autoFleet
    engine.rebalanceOn = rebalanceOn
    engine.detourRatio = detourRatio
    engine.waitMaxMin = waitMaxMin
  }, [engine, demandScale, thresholdMin, autoFleet, rebalanceOn, detourRatio, waitMaxMin])
  // 开发期留一个引擎句柄，便于在控制台快进/核对数据（生产构建不会注入）
  useEffect(() => {
    if (import.meta.env.DEV) window.__simEngine = engine
  }, [engine])

  // 实时推进（到 23:45 自动停表）；8 帧/秒，1× = 1 仿真分钟/秒
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (engine.time < engine.endTime - 1e-6) engine.step(0.125 * speed)
      forceRender((t) => t + 1)
    }, 125)
    return () => clearInterval(id)
  }, [running, speed, engine])

  // 全日回放（1× = 2 仿真分钟 / 秒）
  useEffect(() => {
    if (!replay?.playing || !day) return
    const id = setInterval(() => {
      setReplay((r) => {
        if (!r) return r
        const end = day.summary.window.end
        const next = r.t + 2 * r.speed * 0.1
        if (next >= end) return { ...r, t: end, playing: false }
        return { ...r, t: next }
      })
    }, 100)
    return () => clearInterval(id)
  }, [replay?.playing, replay?.speed, day])

  const bothStops = map.stops.filter((s) => s.type === 'both')
  const metrics = engine.metrics()
  const selected = engine.vehicles.find((v) => v.id === selectedVehicle) || null
  const unreasonableList = engine.flaggedOrders(selectedVehicle || null)
  const farList = unreasonableList.filter((u) => u.flags.some((f) => f.kind === 'far'))
  const otherList = unreasonableList.filter((u) => !u.flags.some((f) => f.kind === 'far'))
  const waitAlerts = engine.waitAlerts(DISPATCH.userWaitAlertMin)
  // 只有仍属于当前引擎的记录才可用于复盘（换图/换运力后旧记录自动失效）
  const focused = focusOrder && engine.unreasonable.includes(focusOrder) ? focusOrder : null
  const liveCost = selected
    ? vehicleDailyCost({
        km: selected.km,
        onDutyMin: Math.max(engine.time - selected.startedAt, 60),
        dayMin: engine.endTime - engine.startTime,
        orders: selected.journal.length,
      })
    : null

  // 回放视图：位置插值 + 已走轨迹 + 当前订单
  const replayView = useMemo(() => {
    if (!day || !replay) return null
    const eng = day.engine
    const pos = eng.positionAt(replay.vehicleId, replay.t)
    if (!pos) return null
    const track = eng.trackOf(replay.vehicleId)
    const trail = []
    for (const p of track) {
      if (p.t > replay.t) break
      trail.push({ x: p.x, y: p.y })
    }
    const stride = Math.max(1, Math.ceil(trail.length / 500))
    const ds = stride > 1 ? trail.filter((_, i) => i % stride === 0) : trail
    const journal = day.summary.journalByVehicle[replay.vehicleId] || []
    const order =
      journal.filter((j) => j.t <= replay.t && (j.doneTime == null || j.doneTime >= replay.t)).slice(-1)[0] || null
    const row = day.summary.rows.find((r) => r.vehicleId === replay.vehicleId)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of track) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    const padX = Math.max(0.4, (maxX - minX) * 0.15)
    const padY = Math.max(0.4, (maxY - minY) * 0.15)
    const bounds =
      track.length > 1
        ? [toLngLat({ x: minX - padX, y: maxY + padY }), toLngLat({ x: maxX + padX, y: minY - padY })]
        : null
    return { id: replay.vehicleId, plate: row?.plate || '', pos, trail: ds, t: replay.t, order, bounds }
  }, [day, replay])

  function setLineFleet(lineId, n) {
    setFleet((f) => ({ ...f, [lineId]: n }))
    setSelectedVehicle(null)
    setFocusOrder(null)
    setCallResult(null)
    setDay(null)
    setReplay(null)
  }

  // 全天跑完（23:45）后重新开一轮，避免「点继续但什么都不动」
  function restartSim() {
    setRunKey((k) => k + 1)
    setRunning(true)
    setSelectedVehicle(null)
    setFocusOrder(null)
    setCallResult(null)
  }

  function doCall() {
    if (!call.fromId || !call.toId) return
    const order = engine.userCall(call.fromId, call.toId)
    setCallResult(order)
    forceRender((t) => t + 1)
  }

  function switchTab(next) {
    setTab(next)
    if (next !== 'driver') {
      setSelectedVehicle(null)
      setFocusOrder(null)
    }
  }

  function renderFlag(u) {
    const isFar = u.flags.some((f) => f.kind === 'far')
    return (
      <div
        key={u.orderId}
        className={`flag-item clickable ${isFar ? 'far-item' : ''} ${focused?.orderId === u.orderId ? 'on' : ''}`}
        onClick={() => setFocusOrder(focused?.orderId === u.orderId ? null : u)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setFocusOrder(focused?.orderId === u.orderId ? null : u)
        }}
      >
        <div className="flag-head">
          <b>{u.plate}</b>
          <span className="meta">单号 {u.orderId} · {fmtClock(u.t)} · 点击复盘</span>
        </div>
        <div className="meta">{u.od}</div>
        {isFar && (
          <div className="far-metric">
            <span>接驾距离 <b>{u.pickupKm?.toFixed(2)} km</b></span>
            <span>预计到达 <b>{u.etaMin?.toFixed(1)} 分钟</b></span>
            <span className="meta">警戒线 {DISPATCH.farPickupMin} 分钟</span>
          </div>
        )}
        {u.flags.filter((f) => f.kind !== 'far').map((f, i) => (
          <div key={i} className={`flag-tag ${f.kind}`}>{f.text}</div>
        ))}
      </div>
    )
  }

  const mapVehicles = tab === 'macro' ? [] : selected ? [selected] : engine.vehicles
  const mapSelectedId = tab === 'macro' ? null : selectedVehicle

  return (
    <div className="sim-stage">
      <header className="sim-head">
        <div className="sim-title">
          <b>云智仿</b>
        </div>
        <div className="sim-controls">
          {map.lines.map((l) => (
            <label className="sim-ctl" key={l.id}>
              <span>
                {l.id} 投放 <b className="teal">{fleet[l.id] ?? 0}</b> 辆
              </span>
              <input
                type="range"
                min="0"
                max="24"
                value={fleet[l.id] ?? 0}
                onChange={(e) => setLineFleet(l.id, Number(e.target.value))}
              />
            </label>
          ))}
          <label className="sim-ctl">
            <span>需求 <b className="teal">{demandScale.toFixed(1)}×</b></span>
            <input type="range" min="0.2" max="3" step="0.1" value={demandScale} onChange={(e) => setDemandScale(Number(e.target.value))} />
          </label>
          <label className="sim-ctl">
            <span>仿真速度</span>
            <span className="seg">
              {SPEEDS.map((s) => (
                <button key={s.v} className={speed === s.v ? 'on' : ''} onClick={() => setSpeed(s.v)}>{s.label}</button>
              ))}
            </span>
          </label>
          {engine.time >= engine.endTime - 1e-6 ? (
            <button className="btn sim" onClick={restartSim}>全天已跑完，重新开始</button>
          ) : (
            <button className={`btn sim ${running ? 'outline' : ''}`} onClick={() => setRunning((r) => !r)}>
              {running ? '暂停仿真' : '继续仿真'}
            </button>
          )}
        </div>
      </header>

      <div className="sim-body">
        <section className="sim-left">
          <SimMap
            key={map.seed}
            map={map}
            vehicles={mapVehicles}
            selectedId={mapSelectedId}
            onSelectVehicle={tab === 'driver' ? setSelectedVehicle : undefined}
            callFromId={tab === 'user' ? call.fromId || null : null}
            callToId={tab === 'user' ? call.toId || null : null}
            focus={tab === 'driver' ? focused : null}
            replay={tab === 'macro' ? replayView : null}
            frame={engine.time}
          />
          <div className="sim-kpis">
            <div className="kpi-cell"><div className="k">仿真时刻</div><div className="v">{fmtClock(engine.time)}</div></div>
            <div className="kpi-cell"><div className="k">呼叫总数</div><div className="v">{metrics.calls}</div></div>
            <div className="kpi-cell"><div className="k">匹配率</div><div className="v">{(metrics.matchRate * 100).toFixed(1)}%</div></div>
            <div className="kpi-cell"><div className="k">平均等待</div><div className="v">{fmtMin(metrics.avgWaitMin)}</div></div>
            <div className="kpi-cell"><div className="k">P90 等待</div><div className="v">{fmtMin(metrics.p90WaitMin)}</div></div>
            <div className="kpi-cell"><div className="k">载客 / 空驶</div><div className="v">{(metrics.utilization * 100).toFixed(0)}% / {((1 - metrics.utilization) * 100).toFixed(0)}%</div></div>
          </div>
          <div className="sim-mapinfo meta">
            大连软件园接驳区 + 凌水—小平岛接驳区 · {map.stops.length} 站（地铁 {map.stops.filter((s) => s.metro).length}）·{' '}
            {map.edges.length} 段道路 · 在营 {engine.vehicles.length} 辆（X1 {engine.vehicles.filter((v) => v.lineId === 'X1').length}/X2{' '}
            {engine.vehicles.filter((v) => v.lineId === 'X2').length}，增派 {metrics.extraVehicles}）
            {tab === 'macro' && replayView ? ' · 正在回放单车全天轨迹' : selected ? ` · 单车视角：仅显示 ${selected.plate}` : ''}
          </div>
        </section>

        <section className="sim-right">
          <nav className="sim-tabs">
            <button className={tab === 'driver' ? 'on' : ''} onClick={() => switchTab('driver')}>司机视角</button>
            <button className={tab === 'user' ? 'on' : ''} onClick={() => switchTab('user')}>用户视角</button>
            <button className={tab === 'macro' ? 'on' : ''} onClick={() => switchTab('macro')}>宏观视角</button>
            <button className={tab === 'demand' ? 'on' : ''} onClick={() => switchTab('demand')}>需求与调度</button>
          </nav>

          {tab === 'driver' && (
            <div className="sim-panel">
              {map.lines.map((l) => {
                const list = engine.vehicles.filter((v) => v.lineId === l.id)
                if (!list.length) return null
                return (
                  <div className="sim-vehicles-line" key={l.id}>
                    <div className="sim-vehicles-head">
                      <b style={{ color: l.color }}>{l.id}</b>
                      <span className="meta">{l.name} · {list.length} 辆 · 车场 {engine.depotOfLine(l.id)?.name || '—'}</span>
                    </div>
                    <div className="sim-vehicles">
                      {list.map((v) => (
                        <button
                          key={v.id}
                          className={`vchip ${selectedVehicle === v.id ? 'on' : ''}`}
                          onClick={() => setSelectedVehicle(selectedVehicle === v.id ? null : v.id)}
                        >
                          {v.plate}
                          {v.added && <em className="add-tag">增派</em>}
                          <i style={{ background: v.state === 'to_pickup' ? '#d4a017' : v.state === 'onboard' ? '#11352c' : '#0f7a62' }} />
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}

              {selected ? (
                <div className="card" style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b style={{ fontSize: 16 }}>{selected.plate}</b>
                    <span className="chip teal">{STATE_LABEL[selected.state] || selected.state}</span>
                  </div>
                  <div className="driver-focus-hint">已进入单车视角 —— 地图只显示该车及其目标行驶线路，其他车辆已隐藏。</div>
                  <div className="meta" style={{ marginTop: 6, lineHeight: 1.9 }}>
                    当前目标：{selected.target?.name || '—'}
                    <br />
                    车上乘客：{selected.riders.length
                      ? selected.riders.map((r) => `${engine.stopOf(r.fromId)?.name}→${engine.stopOf(r.toId)?.name}`).join('；')
                      : '无'}
                    <br />
                    车上人数：{selected.onboard}/{selected.capacity}（座位 {selected.seats}）
                  </div>
                  <div className="kpi" style={{ marginTop: 8 }}>
                    <div className="cell"><div className="k">接单数</div><div className="v">{selected.stats.orders}</div></div>
                    <div className="cell"><div className="k">当日里程</div><div className="v">{selected.km.toFixed(1)} km</div></div>
                    <div className="cell"><div className="k">空驶公里</div><div className="v">{selected.stats.emptyKm.toFixed(1)}</div></div>
                    <div className="cell"><div className="k">当前日成本</div><div className="v">{liveCost ? `¥${liveCost.total.toFixed(0)}` : '—'}</div></div>
                  </div>
                  {selected.order && (
                    <p className="hint" style={{ marginBottom: 0 }}>
                      正在接单：{selected.order.fromName} → {selected.order.toName}（单号 {selected.order.id}，预计 {selected.order.pickupEtaMin?.toFixed(1)} 分钟到达）
                    </p>
                  )}
                </div>
              ) : (
                <p className="hint">在地图或上方列表选择一辆车，实时跟随其运营。选中后地图只保留这辆车及其目标线路，便于专注观察它会不会接到不合理的订单。</p>
              )}

              {focused?.evidence && (
                <div className="card focus-card">
                  <div className="focus-head">
                    <div>
                      <b>{focused.plate} 的订单复盘</b>
                      <div className="meta">单号 {focused.orderId} · {fmtClock(focused.t)} · {focused.od}</div>
                    </div>
                    <button className="btn ghost xs" onClick={() => setFocusOrder(null)}>取消定位</button>
                  </div>
                  <p className="focus-desc">{describeFlag(focused)}</p>
                  <div className="focus-legend">
                    <span><i className="ln gray" />车辆接单前的原路线（灰虚线）</span>
                    <span><i className="ln orange" />改道后去接新乘客（橙虚线）</span>
                    <span><i className="ln blue" />首位乘客 OD 基准（蓝点线）</span>
                  </div>
                  <div className="kpi" style={{ marginTop: 8 }}>
                    <div className="cell"><div className="k">接驾距离</div><div className="v">{focused.pickupKm?.toFixed(2)} km</div></div>
                    <div className="cell"><div className="k">预计到达</div><div className="v">{focused.etaMin?.toFixed(1)} 分</div></div>
                    <div className="cell"><div className="k">额外里程</div><div className="v">{focused.evidence.detour ? `${focused.evidence.detour.incKm.toFixed(2)} km` : '—'}</div></div>
                    <div className="cell"><div className="k">乘车 / OD</div><div className="v">{pct(focused.evidence.detour)}</div></div>
                  </div>
                </div>
              )}

              <h4 className="sim-h4">
                接单距离远（{farList.length}）
                <span className="meta">司机体感最差，已置顶按接驾时长排序</span>
              </h4>
              <div className="sim-flags">
                {farList.length === 0 && <p className="hint">当前没有接驾超过 {DISPATCH.farPickupMin} 分钟的订单。</p>}
                {farList.slice(0, 20).map(renderFlag)}
              </div>

              <h4 className="sim-h4">
                其他疑似不合理订单（{otherList.length}）
                <span className="meta">绕路 / 折返 / 拥挤，点开可在地图上复盘</span>
              </h4>
              <div className="sim-flags">
                {otherList.length === 0 && <p className="hint">暂未发现其他疑似不合理订单。</p>}
                {otherList.slice(0, 30).map(renderFlag)}
              </div>
            </div>
          )}

          {tab === 'user' && (
            <div className="sim-panel">
              <h4 className="sim-h4">发起呼叫（用户视角）</h4>
              <div className="sim-call">
                <label>
                  <span>上车点（仅可乘降点）</span>
                  <select value={call.fromId} onChange={(e) => setCall((c) => ({ ...c, fromId: e.target.value }))}>
                    <option value="">请选择</option>
                    {bothStops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>下车点</span>
                  <select value={call.toId} onChange={(e) => setCall((c) => ({ ...c, toId: e.target.value }))}>
                    <option value="">请选择</option>
                    {map.stops.map((s) => <option key={s.id} value={s.id}>{s.name}{s.metro ? '（地铁）' : ''}</option>)}
                  </select>
                </label>
                <button className="btn sim" onClick={doCall} disabled={!call.fromId || !call.toId}>呼叫车辆</button>
              </div>

              {callResult && (
                <div className="card" style={{ marginTop: 10 }}>
                  {callResult.status === 'assigned' ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                          <div className="meta">匹配车辆</div>
                          <b style={{ fontSize: 18 }}>{engine.vehicles.find((v) => v.id === callResult.vehicleId)?.plate}</b>
                          {callResult.dispatchMode === 'depot' && <em className="add-tag">阈值增派</em>}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="meta">一口价</div>
                          <b style={{ fontSize: 18, color: 'var(--teal)' }}>¥{callResult.fare?.toFixed(2)}</b>
                        </div>
                      </div>
                      <div className="kpi">
                        <div className="cell"><div className="k">车辆到达你</div><div className="v">{callResult.pickupEtaMin?.toFixed(1)} 分钟</div></div>
                        <div className="cell"><div className="k">接驾距离</div><div className="v">{callResult.pickupKm?.toFixed(2)} km</div></div>
                        <div className="cell"><div className="k">OD 距离</div><div className="v">{callResult.odKm.toFixed(1)} km</div></div>
                        <div className="cell"><div className="k">车上人数</div><div className="v">{engine.vehicles.find((v) => v.id === callResult.vehicleId)?.onboard ?? 0}/{VEHICLE.capacity}</div></div>
                      </div>
                      {callResult.dispatchMode === 'depot' && (
                        <p className="hint" style={{ marginBottom: 0 }}>
                          原匹配车辆预计 {callResult.etaOriginal?.toFixed(1)} 分钟到达，超过 {thresholdMin} 分钟阈值；
                          系统从车场派出新车，{callResult.etaNew?.toFixed(1)} 分钟到达，因此本单改派新车。
                        </p>
                      )}
                      {callResult.flags.length > 0 && (
                        <div className="meta">提示：{callResult.flags.map((f) => f.text).join('；')}</div>
                      )}
                    </>
                  ) : (
                    <>
                      <b>未匹配到车辆</b>
                      <p className="hint" style={{ marginBottom: 0 }}>
                        {REASON_TEXT[callResult.rejectReason] || callResult.rejectReason}
                      </p>
                    </>
                  )}
                </div>
              )}

              <h4 className="sim-h4">
                等待超过 {DISPATCH.userWaitAlertMin} 分钟的订单（{waitAlerts.length}）
                <span className="meta">用户体感最差，按等待时长倒序</span>
              </h4>
              <div className="sim-flags">
                {waitAlerts.length === 0 && <p className="hint">当前没有等待超过 {DISPATCH.userWaitAlertMin} 分钟的订单。</p>}
                {waitAlerts.slice(0, 20).map((o) => (
                  <div key={o.id} className="flag-item wait-item">
                    <div className="flag-head">
                      <b>{o.fromName} → {o.toName}</b>
                      <span className="wait-badge">{o.waitMin.toFixed(1)} 分钟</span>
                    </div>
                    <div className="meta">
                      单号 {o.id} · {fmtClock(o.callTime)} 呼叫 · {o.status === 'assigned' ? '仍在等待上车' : o.status === 'onboard' ? '已上车（等待超时）' : '已完成（等待超时）'}
                      {o.vehicleId && ` · ${engine.vehicles.find((v) => v.id === o.vehicleId)?.plate || o.vehicleId}`}
                    </div>
                  </div>
                ))}
              </div>

              <h4 className="sim-h4">实时呼叫流</h4>
              <div className="sim-feed">
                {engine.feed.length === 0 && <p className="hint">等待呼叫…可直接上方手动呼叫，或在「需求与调度」里调高需求倍数。</p>}
                {engine.feed.slice(0, 14).map((f, i) => (
                  <div key={i} className={`feed-item ${f.kind}`}>
                    <span className="meta">{fmtClock(f.t)}</span>
                    {f.kind === 'match' && <>匹配 <b>{engine.vehicles.find((v) => v.id === f.vehicleId)?.plate}</b> → {f.order.fromName}→{f.order.toName}，{f.eta?.toFixed(1)} 分钟到达</>}
                    {f.kind === 'board' && <>{f.order.fromName} 乘客已上车（等待 {f.order.actualWaitMin?.toFixed(1)} 分钟）</>}
                    {f.kind === 'reject' && <span className="red">未派单：{f.order.fromName}→{f.order.toName}（{REASON_TEXT[f.reason] || f.reason}）</span>}
                  </div>
                ))}
              </div>

              <div className="kpi" style={{ marginTop: 10 }}>
                <div className="cell"><div className="k">呼叫数</div><div className="v">{metrics.calls}</div></div>
                <div className="cell"><div className="k">匹配率</div><div className="v">{(metrics.matchRate * 100).toFixed(1)}%</div></div>
                <div className="cell"><div className="k">平均等待</div><div className="v">{fmtMin(metrics.avgWaitMin)}</div></div>
                <div className="cell"><div className="k">超 20 分钟未派单</div><div className="v">{metrics.rejectReasons.wait_too_long || 0}</div></div>
              </div>
            </div>
          )}

          {tab === 'macro' && (
            <MacroPanel
              map={map}
              stopSettings={stopSettings}
              demandScale={demandScale}
              fleet={fleet}
              seed={seed}
              thresholdMin={thresholdMin}
              autoFleet={autoFleet}
              rebalanceOn={rebalanceOn}
              detourRatio={detourRatio}
              waitMaxMin={waitMaxMin}
              day={day}
              onDay={setDay}
              replay={replay}
              onReplay={setReplay}
            />
          )}

          {tab === 'demand' && (
            <DemandSettings
              map={map}
              demand={demand}
              settings={stopSettings}
              onChange={setStopSettings}
              clock={engine.time}
              thresholdMin={thresholdMin}
              onThreshold={setThresholdMin}
              autoFleet={autoFleet}
              onAutoFleet={setAutoFleet}
              rebalanceOn={rebalanceOn}
              onRebalance={setRebalanceOn}
              demandScale={demandScale}
              onDemandScale={setDemandScale}
              detourRatio={detourRatio}
              onDetourRatio={setDetourRatio}
              waitMaxMin={waitMaxMin}
              onWaitMax={setWaitMaxMin}
            />
          )}
        </section>
      </div>
    </div>
  )
}
