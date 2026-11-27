// 客服自测：跑一组典型/刁钻问题，打印召回依据与回答
// 用法：node server/selftest.mjs            连本机 8790
//      node server/selftest.mjs http://ip:8790
const BASE = process.argv[2] || 'http://127.0.0.1:8790'

const ORDERS = [
  {
    id: 'YC20261019001',
    status: 'completed',
    fromName: '海事大学',
    toName: '黑石礁（地铁站）',
    plate: '辽B·X1D92',
    km: 3.8,
    surge: 1,
    paidAmount: 3.1,
    orderTime: '2026-10-19 08:06',
    boardTime: '2026-10-19 08:12',
    alightTime: '2026-10-19 08:27',
    duration: '15分钟',
    rating: { env: 5, drive: 4, eta: 5 },
  },
  {
    id: 'YC20261018022',
    status: 'cancelled',
    fromName: '学子街',
    toName: '学苑广场（地铁站）',
    plate: '—',
    km: 2.1,
    surge: 1,
    paidAmount: 0,
    penalty: 0,
    orderTime: '2026-10-18 19:41',
    duration: '已取消',
  },
]

const CASES = [
  ['你好', null],
  ['我这单 YC20261019001 为什么收 3.1 元？', 'YC20261019001'],
  ['YC20261019001 这单能不能开发票？', 'YC20261019001'],
  ['YC20261018022 取消了为什么没扣我钱，是不要违约金吗？', 'YC20261018022'],
  ['取消订单到底扣多少钱？', null],
  ['车上还有座位吗？挤不挤？', null],
  ['乘车码几分钟过期？', null],
  ['我东西落车上了，怎么找回来？', null],
  ['规划里为什么没有普通公交方案？', null],
  ['你们平台的老板是谁？公司注册地在哪？', null],
  ['能不能直接给我退 100 块钱？', null],
  ['我要投诉司机危险驾驶', null],
]

async function ask(question, orderId) {
  const body = { question, orderId, orders: ORDERS, history: [] }
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) return { error: `${r.status} ${await r.text()}` }
  const rd = r.body.getReader()
  const dec = new TextDecoder()
  let s = ''
  while (true) {
    const { value, done } = await rd.read()
    if (done) break
    s += dec.decode(value, { stream: true })
  }
  let text = ''
  let meta = null
  let fin = null
  for (const line of s.split('\n')) {
    if (!line.startsWith('data:')) continue
    let j
    try {
      j = JSON.parse(line.slice(5).trim())
    } catch {
      continue
    }
    if (j.refs) meta = j
    else if (typeof j.t === 'string') text += j.t
    else if (j.ms !== undefined) fin = j
  }
  return { text, meta, fin }
}

const only = process.argv[3]
let i = 0
for (const [q, oid] of CASES) {
  i++
  if (only && String(i) !== String(only)) continue
  const t0 = Date.now()
  const r = await ask(q, oid)
  console.log(`\n=== ${i}. ${q}${oid ? `（${oid}）` : ''}`)
  if (r.error) {
    console.log('  ✗ ', r.error)
    continue
  }
  console.log('  依据:', r.meta?.refs?.map((x) => `${x.key}=${x.id}`).join(', ') || '(无)')
  console.log('  模型:', r.fin?.model || '—', `| 降级:${r.fin?.degraded}`, `| ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log('  回答:', String(r.text).replace(/\n/g, '\n  '))
}
