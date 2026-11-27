// 探活：服务在跑 exit 0，没在跑 exit 1（给 .bat 用）
const HEALTH = 'http://127.0.0.1:5173/api/health'
try {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 900)
  const r = await fetch(HEALTH, { signal: ac.signal })
  clearTimeout(t)
  process.exit(r.ok ? 0 : 1)
} catch {
  process.exit(1)
}
