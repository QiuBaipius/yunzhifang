// 高德地图 JS API 加载器（单例）
// key 与安全密钥见 data/mapConfig.js；失败原因做了可读化处理。
import { getAmapKey, getAmapSecurityCode } from '../data/mapConfig.js'

let promise = null

const WHY = {
  USERKEY_PLAT_NOMATCH: '该 key 的服务平台不是「Web端(JS API)」',
  INVALID_USER_KEY: 'key 无效或已被删除',
  INVALID_USER_SCODE: '安全密钥（securityJsCode）不正确',
  USER_KEY_RESTRICT: '该 key 的域名白名单不允许当前域名调用',
  DAILY_QUERY_OVER_LIMIT: '该 key 今日配额已用尽',
}

async function sniffReason(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    const text = await r.text()
    const m = /"info"\s*:\s*"([A-Z_]+)"/.exec(text)
    if (!m) return null
    return WHY[m[1]] || `高德返回 ${m[1]}`
  } catch {
    return null
  }
}

export function loadAMap() {
  if (typeof window === 'undefined') return Promise.reject(new Error('浏览器环境不可用'))
  if (window.AMap) return Promise.resolve(window.AMap)
  if (promise) return promise

  const key = getAmapKey()
  const sec = getAmapSecurityCode()
  if (!key) return Promise.reject(new Error('未配置高德 key'))

  const url =
    `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}` +
    '&plugin=AMap.Driving,AMap.Walking,AMap.Scale'

  promise = new Promise((resolve, reject) => {
    window._AMapSecurityConfig = { securityJsCode: sec }
    const s = document.createElement('script')
    s.src = url
    s.async = true
    s.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error('高德脚本已加载但未初始化')))
    s.onerror = async () => {
      const reason = await sniffReason(url)
      promise = null
      reject(new Error(reason || '高德地图脚本加载失败：请检查网络连通性'))
    }
    document.head.appendChild(s)
  })
  return promise
}

export function resetAMap() {
  promise = null
}
