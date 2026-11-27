// 仿真几何工具（纯函数，不依赖固定路网数据）
import { UNITS_PER_KM } from '../data/config.js'

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function km(a, b) {
  return dist(a, b) / UNITS_PER_KM
}

// 行驶用时（分钟）：按 30km/h，即每模拟分钟 0.5km
export function etaMin(kmVal) {
  return kmVal / 0.5
}

// 向量 BA 与 CD 的夹角（0–180°）
export function vectorAngleDeg(a, b, c, d) {
  const v1 = { x: b.x - a.x, y: b.y - a.y }
  const v2 = { x: d.x - c.x, y: d.y - c.y }
  const n1 = Math.hypot(v1.x, v1.y)
  const n2 = Math.hypot(v2.x, v2.y)
  if (!n1 || !n2) return 0
  let cos = (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)
  cos = Math.max(-1, Math.min(1, cos))
  return (Math.acos(cos) * 180) / Math.PI
}

// ∠abc（0–180°）
export function angleDeg(a, b, c) {
  return vectorAngleDeg(a, b, b, c)
}

// 点 p 到线段 ab 的距离
export function distToSegment(p, a, b) {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (!len2) return dist(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
}

// 默认距离函数（直线距离）。仿真引擎始终会注入基于随机路网的最短路径 kmFn，
// 此处仅为不传 kmFn 时的兜底。
export function routeKm(a, b) {
  return km(a, b)
}
