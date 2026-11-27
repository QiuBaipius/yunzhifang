// 算法仿真系统 · 简易 SVG 折线图（无第三方依赖）
export default function LineChart({
  series,
  xLabel,
  yLabel,
  width = 440,
  height = 210,
  yFormat = (v) => v.toFixed(1),
  xFormat = (v) => String(v),
  markers = [],
  yMin,
  yMax,
}) {
  const pad = { l: 46, r: 14, t: 14, b: 30 }
  const allX = series.flatMap((s) => s.points.map((p) => p.x))
  const allY = series.flatMap((s) => s.points.map((p) => p.y))
  if (!allX.length) return <div className="sim-chart-empty">暂无数据</div>
  const x0 = Math.min(...allX)
  const x1 = Math.max(...allX)
  let y0 = yMin != null ? yMin : Math.min(...allY)
  let y1 = yMax != null ? yMax : Math.max(...allY)
  if (y1 - y0 < 1e-6) {
    y1 = y0 + 1
  }
  const px = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r)
  const py = (y) => height - pad.b - ((y - y0) / (y1 - y0)) * (height - pad.t - pad.b)

  const yTicks = []
  for (let i = 0; i <= 4; i++) yTicks.push(y0 + ((y1 - y0) * i) / 4)
  const xTicks = [...new Set(allX)].sort((a, b) => a - b)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sim-chart" role="img" aria-label={`${yLabel} 随 ${xLabel} 变化`}>
      {/* 网格与坐标 */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={py(t)} y2={py(t)} stroke="#e3eae4" strokeWidth="1" />
          <text x={pad.l - 6} y={py(t) + 3.5} fontSize="9" fill="#7a8b84" textAnchor="end">{yFormat(t)}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t} x={px(t)} y={height - 10} fontSize="9" fill="#7a8b84" textAnchor="middle">{xFormat(t)}</text>
      ))}
      <line x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} stroke="#b8c6bf" strokeWidth="1" />
      <line x1={pad.l} x2={pad.l} y1={pad.t} y2={height - pad.b} stroke="#b8c6bf" strokeWidth="1" />

      {/* 标注（如最优点） */}
      {markers.map((m, i) => (
        <g key={i}>
          <line x1={px(m.x)} x2={px(m.x)} y1={pad.t} y2={height - pad.b} stroke="#d4a017" strokeWidth="1.4" strokeDasharray="4 3" />
          <text x={px(m.x)} y={pad.t + 8} fontSize="9.5" fontWeight="700" fill="#8a6a10" textAnchor="middle">{m.label}</text>
        </g>
      ))}

      {/* 数据系列 */}
      {series.map((s, i) => (
        <g key={i}>
          {s.dashed ? (
            <path
              d={s.points.map((p, j) => `${j ? 'L' : 'M'}${px(p.x)} ${py(p.y)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="1.8"
              strokeDasharray="6 4"
            />
          ) : (
            <path
              d={s.points.map((p, j) => `${j ? 'L' : 'M'}${px(p.x)} ${py(p.y)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2.2"
            />
          )}
          {s.points.map((p, j) => (
            <circle key={j} cx={px(p.x)} cy={py(p.y)} r="3" fill={s.color} stroke="#fff" strokeWidth="1" />
          ))}
        </g>
      ))}

      <text x={width / 2} y={height - 1} fontSize="9.5" fill="#5d6f68" textAnchor="middle">{xLabel}</text>
      <text x={10} y={pad.t - 2} fontSize="9.5" fill="#5d6f68">{yLabel}</text>

      {/* 图例 */}
      <g>
        {series.map((s, i) => (
          <g key={i} transform={`translate(${pad.l + i * 108}, ${height - 22})`}>
            <line x1="0" x2="16" y1="0" y2="0" stroke={s.color} strokeWidth="2.4" strokeDasharray={s.dashed ? '5 3' : ''} />
            <text x="20" y="3" fontSize="9" fill="#5d6f68">{s.name}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}
