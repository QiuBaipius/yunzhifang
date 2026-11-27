// 需求与调度设置：逐站可改用地的类型 / 需求程度，以及派车阈值与自动增减车开关
import { CATEGORIES, CATEGORY_MAP, classifyStop, fmtClock, peakMoment } from '../core/demand.js'
import { DEMAND } from '../data/config.js'

const CAT_OPTIONS = CATEGORIES.map((c) => ({ value: c.key, label: c.label }))

export default function DemandSettings({
  map,
  demand,
  settings,
  onChange,
  clock,
  thresholdMin,
  onThreshold,
  autoFleet,
  onAutoFleet,
  rebalanceOn,
  onRebalance,
  demandScale,
  onDemandScale,
  detourRatio = 1 / 3,
  onDetourRatio = () => {},
  waitMaxMin = 20,
  onWaitMax = () => {},
}) {
  const meta = (s) => demand.metaOf(s.id)
  const rows = [...map.stops].sort((a, b) => (meta(b)?.peakRate || 0) - (meta(a)?.peakRate || 0))
  const total = demand.totalRate(clock)
  const byCat = new Map()
  for (const s of map.stops) {
    const c = meta(s)?.category || 'residential'
    byCat.set(c, (byCat.get(c) || 0) + 1)
  }

  const setStop = (id, patch) => {
    const auto = classifyStop(map.stopById.get(id))
    const cur = settings[id] || { category: auto.category, level: 1 }
    onChange({ ...settings, [id]: { ...cur, ...patch } })
  }

  return (
    <div className="sim-panel">
      <h4 className="sim-h4">
        需求模型
        <span className="meta">分站点 × 分时段，运营窗口 {fmtClock(DEMAND.windowStart)} — {fmtClock(DEMAND.windowEnd)}</span>
      </h4>
      <div className="card demand-summary">
        <div className="kpi" style={{ marginTop: 0 }}>
          <div className="cell"><div className="k">当前时刻</div><div className="v">{fmtClock(clock)}</div></div>
          <div className="cell"><div className="k">全网呼叫强度</div><div className="v">{total.toFixed(2)} 单/分</div></div>
          <div className="cell"><div className="k">需求倍数</div><div className="v">{demandScale.toFixed(1)}×</div></div>
          <div className="cell"><div className="k">站点数</div><div className="v">{map.stops.length}</div></div>
        </div>
        <label className="sim-range">
          <span>全网需求倍数</span>
          <input type="range" min="0.2" max="3" step="0.1" value={demandScale} onChange={(e) => onDemandScale(Number(e.target.value))} />
          <b className="teal">{demandScale.toFixed(1)}×</b>
        </label>
        <p className="hint" style={{ marginBottom: 0 }}>
          每站呼叫强度 = 该用地类型的日曲线强度（0–1）× 用地峰值强度 × 本站需求程度 × 全网倍数。
          修改任一参数后，实时仿真会沿用新需求继续推进，无需重置。
        </p>
      </div>

      <h4 className="sim-h4">
        自动匹配结果
        <span className="meta">按站名语义识别用地性质，可逐站手动覆盖</span>
      </h4>
      <div className="demand-cats">
        {CATEGORIES.map((c) => (
          <div key={c.key} className="demand-cat">
            <i style={{ background: c.color }} />
            <div>
              <b>{c.label}</b>
              <div className="meta">{byCat.get(c.key) || 0} 站 · 峰值 {c.peakRate.toFixed(3)} 单/分 · {c.hint}</div>
            </div>
          </div>
        ))}
      </div>

      <h4 className="sim-h4">
        调度规则
        <span className="meta">阈值增派 + 需求预测引导</span>
      </h4>
      <div className="card">
        <label className="sim-range">
          <span>派车阈值（新乘客匹配车辆 ETA 超过即从车场加派）</span>
          <input type="range" min="3" max="20" step="1" value={thresholdMin} onChange={(e) => onThreshold(Number(e.target.value))} />
          <b className="teal">{thresholdMin} 分钟</b>
        </label>
        <div className="toggle-row">
          <label className="toggle">
            <input type="checkbox" checked={autoFleet} onChange={(e) => onAutoFleet(e.target.checked)} />
            <span>自动增减车（车场出入场 / 空驶 20 分钟减派）</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={rebalanceOn} onChange={(e) => onRebalance(e.target.checked)} />
            <span>需求预测引导（空闲车向供小于需站点移动）</span>
          </label>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          两条线路各有车场：X1 在凌水客运站、X2 在和光大厦，增派车辆只从本线路车场出车。
          阈值判断按「新车 ETA vs 原匹配车 ETA」取更小者：
          当原车预计超过 {thresholdMin} 分钟到、而新车更快时，订单改派给刚出场的车。
          引导采用 15 分钟需求预测 + Little 定律（需求车数 ≈ 到达率 × 8 分钟），
          每 2 分钟重算一次，已分配目标会计入供给，避免多车扎堆同一站点。
        </p>
      </div>

      <h4 className="sim-h4">
        拼车规则
        <span className="meta">可行插入 + 逐乘客绕行预算</span>
      </h4>
      <div className="card">
        <label className="sim-range">
          <span>绕行预算（每位乘客的预计乘车里程 ≤ 其 OD 最优路径 ×（1+预算））</span>
          <input type="range" min="0.1" max="0.6" step="0.05" value={detourRatio} onChange={(e) => onDetourRatio(Number(e.target.value))} />
          <b className="teal">{(detourRatio * 100).toFixed(0)}%</b>
        </label>
        <label className="sim-range">
          <span>最长等待（呼叫到上车，含被新订单推迟的老乘客）</span>
          <input type="range" min="10" max="30" step="1" value={waitMaxMin} onChange={(e) => onWaitMax(Number(e.target.value))} />
          <b className="teal">{waitMaxMin} 分钟</b>
        </label>
        <p className="hint" style={{ marginBottom: 0 }}>
          新订单到来时，系统会把它的上车、下车事件插入到每辆车的服务序列里（枚举所有位次），
          只保留「每段载客数 ≤ 容量、每位乘客（含车上已有乘客）的乘车里程不超其 OD 最优路径的
          {((1 + detourRatio) * 100).toFixed(0)}%、所有未上车乘客累计等待 ≤ {waitMaxMin} 分钟」的方案，
          再按「总里程增加最少」选车，最后做一次 or-opt 局部重排。OD 距离取路网最短路，不是直线距离。
        </p>
      </div>

      <h4 className="sim-h4">
        站点需求程度（{rows.length}）
        <span className="meta">需求程度 1.0 = 该用地类型的标准强度</span>
      </h4>
      <div className="demand-list">
        <div className="demand-row head">
          <span>站点</span>
          <span>用地类型</span>
          <span>需求程度</span>
          <span>峰值 单/分</span>
        </div>
        {rows.map((s) => {
          const m = meta(s)
          const cat = m?.category || 'residential'
          const level = m?.level ?? 1
          const catInfo = CATEGORY_MAP.get(cat)
          const peak = peakMoment(cat)
          return (
            <div className="demand-row" key={s.id}>
              <span className="demand-name">
                {s.name}
                {s.metro && <i className="metro-dot" />}
                {m?.category !== m?.autoCategory && <em className="manual-tag">手动</em>}
              </span>
              <span>
                <select value={cat} onChange={(e) => setStop(s.id, { category: e.target.value })}>
                  {CAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </span>
              <span className="demand-level">
                <input type="range" min="0" max="3" step="0.1" value={level} onChange={(e) => setStop(s.id, { level: Number(e.target.value) })} />
                <b>{level.toFixed(1)}</b>
              </span>
              <span className="demand-peak" title={`${catInfo?.hint || ''}；峰值时刻 ${peak.clock}`}>
                {(catInfo.peakRate * level).toFixed(3)}
                <i className="peak-hint">{peak.clock}</i>
              </span>
            </div>
          )
        })}
      </div>
      <p className="hint">
        自动匹配依据：站名关键词（医院 / 高中 / 学校 / 商场 / 软件园 / 地铁站），其余按居民区处理。
        高中站点（如育明高中）的日曲线在 21:00 晚自习放学附近取峰值，学校为 07:20 上学与 16:40 放学双峰。
      </p>
    </div>
  )
}
