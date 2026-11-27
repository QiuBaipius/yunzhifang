// 计价服务：一口价（起步 1 元 / 1km，之后 0.75 元/km）
import { PRICING } from '../data/config.js'

export function fare(kmVal) {
  if (kmVal <= PRICING.baseKm) return PRICING.baseFare
  return round2(PRICING.baseFare + (kmVal - PRICING.baseKm) * PRICING.perKm)
}

function round2(n) {
  return Math.round(n * 100) / 100
}
