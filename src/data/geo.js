// 抽象坐标 ↔ 真实经纬度 的线性投影（与云乘见小程序同一套参数）
//
// 业务算法使用 0–320 的抽象坐标（1 单位 = 25 米），投影到辽宁省大连市高新园区一带。
import { UNITS_PER_KM } from './config.js'
import { BOUNDARY_LNGLAT, RINGS_LNGLAT } from './dalian.js'

const METERS_PER_UNIT = 1000 / UNITS_PER_KM

export const GEO_ORIGIN = { x: 160, y: 150, lng: 121.5434, lat: 38.8768 }

const M_PER_DEG_LAT = 110540
const M_PER_DEG_LNG = 111320 * Math.cos((GEO_ORIGIN.lat * Math.PI) / 180)

export function toLngLat(p) {
  return [
    GEO_ORIGIN.lng + ((p.x - GEO_ORIGIN.x) * METERS_PER_UNIT) / M_PER_DEG_LNG,
    GEO_ORIGIN.lat - ((p.y - GEO_ORIGIN.y) * METERS_PER_UNIT) / M_PER_DEG_LAT,
  ]
}

export function toXY(lng, lat) {
  return {
    x: GEO_ORIGIN.x + ((lng - GEO_ORIGIN.lng) * M_PER_DEG_LNG) / METERS_PER_UNIT,
    y: GEO_ORIGIN.y - ((lat - GEO_ORIGIN.lat) * M_PER_DEG_LAT) / METERS_PER_UNIT,
  }
}

export function mapBounds() {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of Object.values(RINGS_LNGLAT).flat().flat()) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  const padLng = (maxLng - minLng) * 0.06
  const padLat = (maxLat - minLat) * 0.06
  return {
    southWest: [minLng - padLng, minLat - padLat],
    northEast: [maxLng + padLng, maxLat + padLat],
  }
}

export { BOUNDARY_LNGLAT, RINGS_LNGLAT }
