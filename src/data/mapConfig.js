// 地图与平台配置（算法仿真系统 · 独立工程）
//
// 安全说明：key 与安全密钥在前端可见，必须在高德控制台为该 key 配置「域名白名单」；
// 生产环境建议由后端签发，不要把密钥提交进公开仓库。
const LS_KEY = 'simlab.amap.key'
const LS_SEC = 'simlab.amap.security'

const DEFAULT_KEY = 'afd9ed5287f22a90a7bbef3d09c40935'
const DEFAULT_SECURITY = 'f066ef7799e32e2c66e69f775fb57a9a'

function readLS(name) {
  try {
    return localStorage.getItem(name) || ''
  } catch {
    return ''
  }
}

export function getAmapKey() {
  return readLS(LS_KEY) || import.meta.env.VITE_AMAP_KEY || DEFAULT_KEY
}

export function getAmapSecurityCode() {
  return readLS(LS_SEC) || import.meta.env.VITE_AMAP_SECURITY_CODE || DEFAULT_SECURITY
}
