// 宏观视角：全日仿真 → 每车运营成本 + 多倍速轨迹与接单回溯；以及运力扫描
// 全日仿真与运力扫描统一走 core/runner.js 的 runScenario（与命令行同一套逻辑）
import { useEffect, useRef, useState } from 'react'
import LineChart from './Chart.jsx'
import { kpisObject, ordersTable, runScenario, summaryText, toCsv, trajectoriesTable, vehiclesTable } from '../core/runner.js'
import { defaultScenario } from '../core/scenario.js'
import { fmtClock } from '../core/demand.js'
import { DEMAND } from '../data/config.js'

const FLEET_SWEEP = [2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32]
const SPEEDS = [1, 8, 32, 120]
const MAX_TRACK_ROWS = 120000

const money = (v) => (v == null ? '—' : `¥${v.toFixed(0)}`)
const money2 = (v) => (v == null ? '—' : `¥${v.toFixed(2)}`)

const safeName = (s) => (s || 'scenario').replace(/[\\/:*?"<>|\s｜]/g, '_').slice(0, 60)

// 前端导出：Blob + <a download>，CSV 带 BOM 以便 Excel 正确识别中文
function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function fitPower(rows) {
  const pts = rows.filter((r) => r.avgWaitMin > 0.01).map((r) => ({ x: Math.log(r.n), y: Math.log(r.avgWaitMin) }))
  if (pts.length < 3) return null
  const k = pts.length
  const sx = pts.reduce((s, p) => s + p.x, 0)
  const sy = pts.reduce((s, p) => s + p.y, 0)
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0)
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0)
  const b = (k * sxy - sx * sy) / (k * sxx - sx * sx)
  const a = Math.exp((sy - b * sx) / k)
  const ybar = sy / k
  const ssTot = pts.reduce((s, p) => s + (p.y - ybar) ** 2, 0)
  const ssRes = pts.reduce((s, p) => s + (p.y - (Math.log(a) + b * p.x)) ** 2, 0)
  return { a, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 }
}

export default function MacroPanel({
  map,
  stopSettings = {},
  demandScale,
  fleet = { X1: 8, X2: 4 },
  seed,
  thresholdMin,
  autoFleet,
  rebalanceOn,
  detourRatio = 1 / 3,
  waitMaxMin = 20,
  day,
  onDay,
  replay,
  onReplay,
}) {
  const [busy, setBusy] = useState(false)
  const [sweep, setSweep] = useState(null)
  const [sweeping, setSweeping] = useState(false)
  const replayRef = useRef(null)

  // 点开某一辆车后，把回放卡滚到可见区域
  useEffect(() => {
    if (replay?.vehicleId) replayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [replay?.vehicleId])

  const fleetTotal = map.lines.reduce((s, l) => s + (fleet[l.id] || 0), 0)
  const fleetText = map.lines.map((l) => `${l.id} ${fleet[l.id] || 0} 辆`).join(' + ')

  // 用当前界面参数拼一份场景配置：结构与命令行使用的 *.json 完全一致
  // 传入 vehicles（数字）时按总数扫描；否则按界面上的 X1 / X2 分别投放
  function buildScenario({ vehicles = null, fleet: fleetOverride = {}, sim = {} } = {}) {
    const total = vehicles == null ? fleetTotal : vehicles
    const initial =
      vehicles == null ? Object.fromEntries(map.lines.map((l) => [l.id, fleet[l.id] || 0])) : vehicles
    return defaultScenario({
      名称: `大连软件园 · 种子 ${seed} · ${total} 辆 · 需求 ${demandScale.toFixed(1)}×`,
      路网: { 种子: map.seed, 规模: map.size },
      需求: { 倍数: demandScale, 站点: stopSettings },
      车队: { 初始车辆: initial, 自动增派: autoFleet, ...fleetOverride },
      调度: { 派车阈值: thresholdMin, 绕行预算: detourRatio, 最长等待: waitMaxMin, 预测引导: rebalanceOn },
      仿真: { 随机种子: (seed % 100000) + 13, 步长: 0.5, 记录轨迹: true, ...sim },
    })
  }

  function runDay() {
    setBusy(true)
    setTimeout(() => {
      onDay(runScenario(buildScenario()))
      setBusy(false)
    }, 30)
  }

  function runSweep() {
    setSweeping(true)
    setSweep(null)
    setTimeout(() => {
      const rows = []
      for (const n of FLEET_SWEEP) {
        const res = runScenario(
          buildScenario({
            vehicles: n,
            fleet: { 自动增派: false },
            sim: { 随机种子: (seed % 100000) + n * 7, 开始: '07:00', 结束: '13:00' },
          }),
        )
        rows.push({
          n,
          calls: res.kpis.calls,
          matchRate: res.kpis.matchRate,
          avgWaitMin: res.kpis.avgWaitMin,
          p90WaitMin: res.kpis.p90WaitMin,
          utilization: res.kpis.utilization,
          farOrders: res.kpis.farOrders,
          cost: res.summary.totals.cost,
          perOrder: res.summary.totals.perOrder,
        })
      }
      const fit = fitPower(rows)
      const optimal = rows.find((r) => r.avgWaitMin <= 4 && r.matchRate >= 0.98)
      let marginal = null
      if (fit && fit.b < 0) {
        const nEnd = optimal ? optimal.n : FLEET_SWEEP[FLEET_SWEEP.length - 1]
        marginal = Math.abs(fit.a * fit.b * Math.pow(nEnd, fit.b - 1))
      }
      setSweep({ rows, fit, optimal, marginal })
      setSweeping(false)
    }, 30)
  }

  // 导出与命令行 runs/ 目录同口径的表格
  function exportResult(kind) {
    if (!day) return
    const base = `${safeName(day.config.name)}-${day.map.seed}`
    const csv = (rows) => download(`${base}-${kind}.csv`, '\uFEFF' + toCsv(rows), 'text/csv;charset=utf-8')
    if (kind === '订单') csv(ordersTable(day))
    else if (kind === '车辆') csv(vehiclesTable(day))
    else if (kind === '轨迹') {
      const total = Object.values(day.engine.tracks).reduce((s, t) => s + t.length, 0)
      const stride = Math.max(1, Math.ceil(total / MAX_TRACK_ROWS))
      csv(trajectoriesTable(day, stride))
    } else if (kind === '指标') {
      download(`${base}-指标.json`, JSON.stringify(kpisObject(day), null, 2) + '\n', 'application/json;charset=utf-8')
    } else if (kind === '摘要') {
      download(`${base}-摘要.txt`, summaryText(day) + '\n')
    }
  }

  const waitSeries = sweep
    ? [
        { name: '实测平均等待', color: '#0f7a62', points: sweep.rows.map((r) => ({ x: r.n, y: r.avgWaitMin })) },
        ...(sweep.fit
          ? [{
              name: '拟合曲线',
              color: '#d4a017',
              dashed: true,
              points: sweep.rows.map((r) => ({ x: r.n, y: sweep.fit.a * Math.pow(r.n, sweep.fit.b) })),
            }]
          : []),
      ]
    : []
  const matchSeries = sweep
    ? [{ name: '匹配率', color: '#2d6cdf', points: sweep.rows.map((r) => ({ x: r.n, y: r.matchRate * 100 })) }]
    : []

  const rows = day?.summary?.rows || []
  const totals = day?.summary?.totals || null
  const journal = replay && day ? day.summary.journalByVehicle[replay.vehicleId] || [] : []
  const curOrder = journal.filter((j) => j.t <= replay.t && (j.doneTime == null || j.doneTime >= replay.t)).slice(-1)[0] || null
  const dayMin = day ? day.summary.window.dayMin : DEMAND.dayMin

  return (
    <div className="sim-panel">
      <div className="macro-heading">
        <div className="macro-heading-text">
          <h4 className="sim-h4">宏观视角：全日运营成本</h4>
          <span className="meta">
            {fmtClock(DEMAND.windowStart)}—{fmtClock(DEMAND.windowEnd)} · 投放 {fleetText}（{fleetTotal} 辆）· 需求 {demandScale.toFixed(1)}×
          </span>
          <span className="meta">
            阈值 {thresholdMin} 分钟 · {autoFleet ? '自动增减车' : '固定车队'} · {rebalanceOn ? '需求预测引导' : '不引导'}
          </span>
        </div>
        <button className="btn sim" onClick={runDay} disabled={busy}>
          {busy ? '全日仿真计算中…' : '运行全日仿真'}
        </button>
      </div>

      {!day && (
        <p className="hint">跑完整日后可看每车里程、订单与成本，点车辆按时序回放轨迹和接单。</p>
      )}

      {day && totals && (
        <>
          <div className="kpi" style={{ marginTop: 10 }}>
            <div className="cell"><div className="k">投入车辆</div><div className="v">{totals.vehicles} 辆</div></div>
            <div className="cell"><div className="k">完成订单</div><div className="v">{totals.orders}</div></div>
            <div className="cell"><div className="k">总行驶里程</div><div className="v">{totals.km.toFixed(0)} km</div></div>
            <div className="cell"><div className="k">总运营成本</div><div className="v">{money(totals.cost)}</div></div>
            <div className="cell"><div className="k">单均成本</div><div className="v">{money2(totals.perOrder)}</div></div>
            <div className="cell"><div className="k">车公里成本</div><div className="v">{money2(totals.perKm)}</div></div>
            <div className="cell"><div className="k">票款收入</div><div className="v">{money(totals.revenue)}</div></div>
            <div className="cell"><div className="k">收支差</div><div className={`v ${totals.net < 0 ? 'red' : 'teal'}`}>{money(totals.net)}</div></div>
          </div>

          <div className="card" style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <b>本次仿真输出</b>
              <span className="meta">{day.label} · 仿真耗时 {(day.elapsedMs / 1000).toFixed(2)} 秒</span>
            </div>
            <div className="macro-actions" style={{ marginTop: 8 }}>
              <button className="btn sim outline" onClick={() => exportResult('订单')}>订单 CSV</button>
              <button className="btn sim outline" onClick={() => exportResult('车辆')}>车辆 CSV</button>
              <button className="btn sim outline" onClick={() => exportResult('轨迹')}>轨迹 CSV</button>
              <button className="btn sim outline" onClick={() => exportResult('指标')}>指标 JSON</button>
              <button className="btn sim outline" onClick={() => exportResult('摘要')}>摘要 TXT</button>
            </div>
            <p className="hint" style={{ margin: '6px 0 0' }}>
              命令行 <code>node scripts/simlab.mjs</code> 输出的是同一套表格（orders / vehicles / trajectories / kpis / summary），
              可用于报告与批量场景对比。
            </p>
            {day.warnings.length > 0 && (
              <ul className="hint" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {day.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <details style={{ marginTop: 8 }}>
              <summary className="meta">查看摘要文本（summary.txt）</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7, margin: '6px 0 0' }}>{summaryText(day)}</pre>
            </details>
          </div>

          <div className="card cost-formula">
            <b>成本计算口径</b>
            <p>{day.summary.formula.text}</p>
            <details>
              <summary>常数来源（成本规制 / 车型实测）</summary>
              <ul>
                {day.summary.formula.sources.map((s) => <li key={s}>{s}</li>)}
                <li>唯一随仿真变化的量是该车当日的运行里程；增派车的固定成本按在岗时长折算（最少按 1 小时）。</li>
              </ul>
            </details>
          </div>

          <h4 className="sim-h4">
            每车日运营成本
            <span className="meta">按成本从低到高排序 · 点击任意一行回溯该车全天</span>
          </h4>
          <div className="table-scroll">
            <table className="sim-table">
              <thead>
                <tr>
                  <th>车辆</th><th>里程</th><th>订单</th><th>日成本</th><th>单均</th>
                  <th>载客率</th><th>固定</th><th>里程成本</th><th>收入</th><th>收支差</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.vehicleId}
                    className={`clickable ${replay?.vehicleId === r.vehicleId ? 'opt' : ''}`}
                    onClick={() => onReplay({ vehicleId: r.vehicleId, t: day.summary.window.start, playing: false, speed: 32 })}
                  >
                    <td>
                      {r.plate}
                      {r.added && <em className="add-tag">增派</em>}
                    </td>
                    <td>{r.km.toFixed(0)} km</td>
                    <td>{r.orders}</td>
                    <td><b>{money(r.cost.total)}</b></td>
                    <td>{money2(r.perOrderCost)}</td>
                    <td>{(r.utilization * 100).toFixed(0)}%</td>
                    <td>{money(r.cost.fixed)}</td>
                    <td>{money(r.cost.variable)}</td>
                    <td>{money(r.revenue)}</td>
                    <td className={r.revenue - r.cost.total < 0 ? 'red' : 'teal'}>{money(r.revenue - r.cost.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            成本特别高或特别低的车辆，直接点该行进入下方回放：按时间顺序查看它当天每一段空驶、每一单接客与绕路，
            判断是「需求分配不均」「阈值增派后空驶过多」还是「个别订单跑得太远」。
          </p>

          {replay && (
            <div className="card replay-card" ref={replayRef}>
              <div className="replay-head">
                <b>全日回放 · {rows.find((r) => r.vehicleId === replay.vehicleId)?.plate || ''}</b>
                <button className="btn ghost xs" onClick={() => onReplay(null)}>退出回放</button>
              </div>
              <div className="replay-controls">
                <button className="btn sim" onClick={() => onReplay({ ...replay, playing: !replay.playing })}>
                  {replay.playing ? '暂停回放' : '播放回放'}
                </button>
                <span className="replay-clock">{fmtClock(replay.t)}</span>
                <span className="seg">
                  {SPEEDS.map((s) => (
                    <button key={s} className={replay.speed === s ? 'on' : ''} onClick={() => onReplay({ ...replay, speed: s })}>
                      {s}×
                    </button>
                  ))}
                </span>
                <span className="meta">
                  1× = 每 1 秒回放 2 分钟 · 全天约{' '}
                  {(() => {
                    const secs = Math.round(dayMin / (2 * replay.speed))
                    return secs >= 60 ? `${Math.floor(secs / 60)} 分 ${secs % 60} 秒` : `${secs} 秒`
                  })()}
                </span>
              </div>
              <input
                className="replay-range"
                type="range"
                min={day.summary.window.start}
                max={day.summary.window.end}
                step={1}
                value={Math.round(replay.t)}
                onChange={(e) => onReplay({ ...replay, t: Number(e.target.value), playing: false })}
              />
              <div className="replay-now">
                {curOrder ? (
                  <>
                    <span className="chip teal">{fmtClock(curOrder.t)}</span>
                    <b>{curOrder.orderId}</b> {curOrder.fromName} → {curOrder.toName}
                    <span className="meta">
                      {' '}接驾 {curOrder.etaMin?.toFixed(1)} 分钟 / {curOrder.pickupKm?.toFixed(2)} km · OD {curOrder.odKm.toFixed(2)} km · 票价 ¥{curOrder.revenue.toFixed(2)}
                      {curOrder.waitMin != null && ` · 实际等待 ${curOrder.waitMin.toFixed(1)} 分钟`}
                    </span>
                    {curOrder.flags?.includes('far') && <span className="flag-tag far inline">接单距离远</span>}
                  </>
                ) : (
                  <span className="meta">当前时刻无进行中的订单（空驶 / 驻站候单 / 回场）</span>
                )}
              </div>
              <h4 className="sim-h4">
                当日接单流水（{journal.length}）
                <span className="meta">点击任意一单，回放到该时刻</span>
              </h4>
              <div className="replay-orders">
                {journal.map((j) => (
                  <button
                    key={j.orderId}
                    className={`replay-order ${curOrder?.orderId === j.orderId ? 'on' : ''}`}
                    onClick={() => onReplay({ ...replay, t: j.t, playing: false })}
                  >
                    <span className="meta">{fmtClock(j.t)}</span>
                    <span>{j.fromName} → {j.toName}</span>
                    <span className="meta">{j.odKm.toFixed(1)} km · 等 {j.waitMin != null ? j.waitMin.toFixed(1) : '—'} 分</span>
                    {j.flags?.includes('far') && <em className="flag-mini">远</em>}
                    {j.dispatchMode === 'depot' && <em className="flag-mini depot">增派</em>}
                  </button>
                ))}
                {journal.length === 0 && <p className="hint">该车当日没有接到订单。</p>}
              </div>
            </div>
          )}
        </>
      )}

      <h4 className="sim-h4">
        运力扫描（07:00—13:00）
        <span className="meta">同一需求下投放量对等待与匹配率的影响</span>
      </h4>
      <div className="macro-scan-actions">
        <button className="btn sim outline" onClick={runSweep} disabled={sweeping}>
          {sweeping ? '扫描计算中…' : `运行扫描（${FLEET_SWEEP.join(' / ')} 辆）`}
        </button>
      </div>
      <p className="hint hint-one">只跑 6 小时：{FLEET_SWEEP.length} 组全天要 1 分多钟且卡页面；实测与全天差 &lt; 0.2 分钟。</p>

      {sweep && (
        <>
          <div className="sim-conclusion card">
            <b>结论</b>
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.8 }}>
              扫描时段（07:00—13:00）：平均等待与投放车辆数近似呈
              <b className="teal"> W(N) ≈ {sweep.fit ? `${sweep.fit.a.toFixed(2)} × N^(${sweep.fit.b.toFixed(2)})` : '—'}</b> 分钟
              {sweep.fit && (
                <>
                  （R² = {sweep.fit.r2.toFixed(3)}；车辆数翻倍时平均等待降至原来的{' '}
                  <b className="teal">{(Math.pow(2, sweep.fit.b) * 100).toFixed(0)}%</b>）
                </>
              )}
              。
              {sweep.optimal ? (
                <>满足「平均等待 ≤ 4 分钟且匹配率 ≥ 98%」的最小投放数为 <b className="teal">{sweep.optimal.n} 辆</b>（平均等待 {sweep.optimal.avgWaitMin.toFixed(2)} 分钟）。</>
              ) : (
                <>扫描范围内没有同时满足等待与匹配率目标的投放数，建议提高运力或平抑需求。</>
              )}
              {sweep.marginal != null && <>按拟合曲线，超过该运力后每增加 1 辆车，平均等待仅再缩短约 <b className="teal">{sweep.marginal.toFixed(2)} 分钟</b>。</>}
            </p>
          </div>

          <h4 className="sim-h4">平均等待时间 vs 投放车辆数</h4>
          <LineChart
            series={waitSeries}
            xLabel="投放车辆数 N（辆）"
            yLabel="平均等待（分钟）"
            markers={sweep.optimal ? [{ x: sweep.optimal.n, label: `最优 ${sweep.optimal.n} 辆` }] : []}
          />
          <h4 className="sim-h4">匹配率 vs 投放车辆数</h4>
          <LineChart
            series={matchSeries}
            xLabel="投放车辆数 N（辆）"
            yLabel="匹配率（%）"
            yMin={80}
            yMax={100}
            yFormat={(v) => `${v.toFixed(0)}%`}
            markers={sweep.optimal ? [{ x: sweep.optimal.n, label: `最优 ${sweep.optimal.n} 辆` }] : []}
          />
          <h4 className="sim-h4">扫描明细</h4>
          <div className="table-scroll">
            <table className="sim-table">
              <thead>
                <tr><th>投放数</th><th>呼叫数</th><th>匹配率</th><th>平均等待</th><th>P90</th><th>空驶率</th><th>远单</th><th>成本(6h)</th><th>单均</th></tr>
              </thead>
              <tbody>
                {sweep.rows.map((r) => (
                  <tr key={r.n} className={sweep.optimal?.n === r.n ? 'opt' : ''}>
                    <td>{r.n}</td>
                    <td>{r.calls}</td>
                    <td>{(r.matchRate * 100).toFixed(1)}%</td>
                    <td>{r.avgWaitMin.toFixed(2)}</td>
                    <td>{r.p90WaitMin.toFixed(1)}</td>
                    <td>{((1 - r.utilization) * 100).toFixed(0)}%</td>
                    <td>{r.farOrders}</td>
                    <td>{money(r.cost)}</td>
                    <td>{money2(r.perOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
