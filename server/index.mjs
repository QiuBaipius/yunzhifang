// 云乘见本地服务
//   ① /api/chat   —— 检索（分级 RAG）+ 调 GLM，SSE 流式返回；密钥只在服务端
//   ② /api/health —— 模型与知识库状态
//   ③ 静态托管    —— 直接托管 web/dist 与 simlab/dist，双击 bat 就能用，不依赖任何 dev server
//
// 启动：node server/index.mjs            同时起 5173 / 5174 / 8790
//      node server/index.mjs --api-only  只起 8790（给 vite dev 用）
import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import http from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMessages, kbStats, loadKB, orderFact, retrieve, saveKB } from './rag.mjs'
import { embedBackend, rerank as modelRerank } from './embedding.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(HERE, '..')

// ---- 配置 ----
const cfg = (() => {
  const file = join(HERE, 'config.local.json')
  let local = {}
  if (existsSync(file)) {
    try {
      local = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      console.warn('[config] config.local.json 解析失败：', e.message)
    }
  }
  return {
    // 密钥只从环境变量或本地 config.local.json 读取；仓库不含任何真实 key
    apiKey: process.env.GLM_API_KEY || local.apiKey || '',
    // 首选 4.7-flash；高峰期会返回 429，按顺序降级，保证客服始终可用
    models: local.models || ['glm-4.7-flash', 'glm-4.5-flash', 'glm-4-flash'],
    baseUrl: local.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    maxTokens: local.maxTokens || 520,
    temperature: typeof local.temperature === 'number' ? local.temperature : 0.3,
    apiPort: local.apiPort || 8790,
    webPort: local.webPort || 5173,
    simPort: local.simPort || 5174,
  }
})()

// 记住最近一次成功的模型，避免每次都先撞 4.7-flash 的 429；10 分钟后重试首选模型
let preferred = null
let preferredAt = 0
const PREF_TTL = 10 * 60 * 1000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function json(res, code, body) {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) })
  res.end(s)
}

function readBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

// ---- 归一化订单（前端只传结构化字段，事实卡由服务端拼，避免模型被前端文案带跑）----
function normOrders(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, 8)
    .map((o) => ({
      id: String(o.id || ''),
      status: String(o.status || ''),
      fromName: o.fromName || '',
      toName: o.toName || '',
      actualAlightName: o.actualAlightName || '',
      plate: o.plate || '',
      km: Number(o.km) || 0,
      surge: Number(o.surge) || 1,
      amount: Number(o.amount) || 0,
      paidAmount: o.paidAmount != null ? Number(o.paidAmount) : Number(o.amount) || 0,
      extraFee: Number(o.extraFee) || 0,
      penalty: Number(o.penalty) || 0,
      refund: Number(o.refund) || 0,
      orderTime: o.orderTime || '',
      boardTime: o.boardTime || '',
      alightTime: o.alightTime || '',
      duration: o.duration || '',
      rating: o.rating && typeof o.rating === 'object' ? o.rating : null,
      invoiceEmail: o.invoiceEmail || '',
    }))
    .filter((o) => o.id)
}

// ---- 兜底回答（模型不可用时也给出有依据的答复，而不是白屏）----
// 注意：这里是对客话术，不能把知识库里给模型看的指令性文字（如"不要透露费率"）原样吐出
function fallbackAnswer(docs, orders, focus) {
  if (!docs.length) {
    return 'AI 客服暂时连不上，这条问题我先记下了。你可以稍后重试，或转人工客服跟进。'
  }
  // 用规则的 title 提炼干净的对客结论，只取前两条，且不暴露定价参数
  const brief = docs
    .slice(0, 2)
    .map((d) => d.title)
    .filter(Boolean)
  const head = brief.length
    ? `AI 客服暂时连不上，先按平台规则给你一个简短答复：${brief.join('；')}。`
    : 'AI 客服暂时连不上。'
  const focusLine = focus ? `你正在咨询的订单 ${focus.id}，具体金额以订单详情页为准。` : ''
  return `${head}${focusLine ? ' ' + focusLine : ''}如需更详细的解释或人工复核，请稍后重试或转人工。`
}

function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')
}

const send = (res, event, data) => {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// ---- 未命中问题记录（效果看板的输入）----
// 规则库没覆盖的问题按天累加到 misses.jsonl：运营看「最近问了什么我答不上来」，
// 直接补条目即可闭环（这就是 7.3 里「Top 未命中问题」的最小实现）。
const MISS_FILE = join(HERE, 'misses.jsonl')

function logMiss(question, hit) {
  const row = JSON.stringify({ at: new Date().toISOString(), q: question, best: Number(hit.best || 0).toFixed(3) })
  appendFile(MISS_FILE, row + '\n').catch(() => {})
}

function readMisses(limit = 500) {
  if (!existsSync(MISS_FILE)) return []
  const lines = readFileSync(MISS_FILE, 'utf8').trim().split('\n').filter(Boolean)
  return lines.slice(-limit).map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return null
    }
  }).filter(Boolean)
}

// ---- /api/chat ----
async function handleChat(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: '只支持 POST' })
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return json(res, 400, { error: e.message })
  }
  const question = String(body.question || '').trim().slice(0, 600)
  if (!question) return json(res, 400, { error: '问题不能为空' })

  const orders = normOrders(body.orders)
  const orderId = body.orderId ? String(body.orderId) : null
  const focus = orderId ? orders.find((o) => o.id === orderId) || null : null
  const history = Array.isArray(body.history) ? body.history : []

  // 问「我什么时候上的车」这种订单事实时用户往往不指定 orderId，
  // 覆盖判定用当前咨询单，没指定就退到最近一笔订单（orders 已按焦点/时间排好）。
  const factOrder = focus || orders[0] || null
  const hit = retrieve(question, { order: factOrder })
  let docs = hit.docs
  // 模型增强重排（bge-reranker / 智谱 rerank）：在初检候选上再排一次序。
  // 只在非订单事实题上跑——订单题的答案在订单卡里，不需要规则库排先后。
  if (!hit.smalltalk && !hit.fromOrder && docs.length > 1) {
    try {
      const rr = await modelRerank(question, docs.map((d) => `${d.title} ${String(d.text).slice(0, 300)}`))
      const rank = new Map(rr.map((x, i) => [x.index, Number(x.score) || rr.length - i]))
      docs = docs
        .map((d, i) => ({ d, s: rank.get(i) ?? 0 }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.d)
    } catch (e) {
      console.warn('[rerank] 跳过：', e.message)
    }
  }
  if (!hit.covered && !hit.smalltalk) logMiss(question, hit)
  // 当前咨询的订单排最前，并显式标注，让模型明确知道"这一单"是哪一单
  const ordered = focus
    ? [focus, ...orders.filter((o) => o.id !== focus?.id)]
    : orders
  const factTexts = ordered.map((o, i) => orderFact(o, i + 1, { focus: o.id === focus?.id })).filter(Boolean)

  const messages = buildMessages({
    question,
    history,
    docs,
    orders: factTexts,
    covered: hit.covered,
    smalltalk: !!hit.smalltalk,
  })

  sseHead(res)
  send(res, 'meta', {
    refs: docs.map((d, i) => ({ key: `K${i + 1}`, id: d.id, title: d.title, level: d.level, src: d.src, text: d.text })),
    orderCards: ordered.map((o, i) => ({ key: `O${i + 1}`, id: o.id, text: orderFact(o, i + 1, { focus: o.id === focus?.id }) })),
    covered: hit.covered,
    smalltalk: !!hit.smalltalk,
    gate: hit.gated || [],
    model: cfg.models[0],
  })

  let answered = false
  let used = null
  let lastErr = ''
  const t0 = Date.now()

  // 上一个成功的模型优先：4.7-flash 高峰期限流时，不必每次都先撞一次 429（能省 1–3 秒）
  if (preferred && Date.now() - preferredAt > PREF_TTL) preferred = null
  const chain = [...cfg.models]
  if (preferred && chain.includes(preferred)) chain.splice(chain.indexOf(preferred), 1)
  if (preferred) chain.unshift(preferred)

  for (const model of chain) {
    const ac = new AbortController()
    // 4.5-flash 关掉思维链后首字仍可能 15–20s，超时放宽到 40s，避免误判成失败
    const timer = setTimeout(() => ac.abort(), 40000)
    try {
      const r = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          temperature: cfg.temperature,
          max_tokens: cfg.maxTokens,
          // 关掉思维链：客服要的是短答，开了会多花 5–15 秒，还容易把推理过程说漏
          thinking: { type: 'disabled' },
        }),
        signal: ac.signal,
      })
      if (!r.ok) {
        const t = await r.text().catch(() => '')
        lastErr = `${model} ${r.status} ${t.slice(0, 120)}`
        clearTimeout(timer)
        continue
      }
      used = model
      preferred = model
      preferredAt = Date.now()
      send(res, 'model', { model })
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop() || ''
        for (const line of parts) {
          const s = line.trim()
          if (!s.startsWith('data:')) continue
          const payload = s.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          let j
          try {
            j = JSON.parse(payload)
          } catch {
            continue
          }
          const d = j.choices?.[0]?.delta
          const piece = d?.content
          if (piece) {
            answered = true
            send(res, 'delta', { t: piece })
          }
        }
      }
      clearTimeout(timer)
      break
    } catch (e) {
      clearTimeout(timer)
      lastErr = `${model} ${e.name === 'AbortError' ? '超时' : e.message}`
    }
  }

  if (!answered) {
    const text = fallbackAnswer(docs, orders, focus)
    send(res, 'delta', { t: text })
    send(res, 'done', { model: null, degraded: true, error: lastErr, ms: Date.now() - t0 })
    res.end()
    return
  }
  send(res, 'done', { model: used, degraded: false, ms: Date.now() - t0 })
  res.end()
}

// ---- /api/kb/search —— 检索测试台 ----
// 运营在管理页输入一个问题，直接看到四路召回的名次、RRF 融合、重排结果与拼装后的 prompt，
// 不用改代码就能判断「该召回的有没召回、不该召回的有没有占位」。
async function handleSearch(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: '只支持 POST' })
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return json(res, 400, { error: e.message })
  }
  const question = String(body.question || '').trim().slice(0, 300)
  if (!question) return json(res, 400, { error: '问题不能为空' })
  const orders = normOrders(body.orders)
  const orderId = body.orderId ? String(body.orderId) : null
  const focus = orderId ? orders.find((o) => o.id === orderId) || null : null

  const hit = retrieve(question, { order: focus, debug: true })
  const factTexts = orders.map((o, i) => orderFact(o, i + 1, { focus: o.id === focus?.id })).filter(Boolean)
  const messages = buildMessages({
    question,
    docs: hit.docs,
    orders: factTexts,
    covered: hit.covered,
    smalltalk: !!hit.smalltalk,
  })
  return json(res, 200, {
    question,
    ...hit.debug,
    docs: hit.docs.map((d) => ({
      id: d.id,
      title: d.title,
      cat: d.cat,
      level: d.level,
      src: d.src,
      score: d.score,
      text: String(d.text).slice(0, 220),
    })),
    prompt: messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n'),
    ms: 0,
  })
}

// ---- /api/kb/misses —— 未命中问题榜 ----
function handleMisses(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: '只支持 GET' })
  const rows = readMisses()
  const agg = new Map()
  for (const r of rows) {
    const key = String(r.q || '').trim()
    if (!key) continue
    const cur = agg.get(key) || { q: key, n: 0, last: '' }
    cur.n += 1
    if (String(r.at) > cur.last) cur.last = r.at
    agg.set(key, cur)
  }
  const list = [...agg.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, 20)
  return json(res, 200, { total: rows.length, list })
}

// ---- 静态资源 ----
function serveStatic(rootDir, req, res) {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let rel = normalize(url).replace(/^([/\\])+/, '')
  if (rel.includes('..')) return json(res, 403, { error: 'forbidden' })
  let file = join(rootDir, rel)
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(rootDir, 'index.html')
  if (!existsSync(file)) return json(res, 404, { error: `未找到 ${rel}，请先构建（npm run build）` })
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  })
  createReadStream(file).pipe(res)
}

function makeServer(handler) {
  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    handler(req, res).catch((e) => {
      console.error('[500]', e)
      if (!res.headersSent) json(res, 500, { error: e.message })
      else res.end()
    })
  })
}

async function apiHandler(req, res) {
  const path = (req.url || '/').split('?')[0]
  if (path === '/api/health') {
    return json(res, 200, {
      ok: true,
      key: cfg.apiKey ? '已配置' : '缺少 key',
      models: cfg.models,
      embedding: embedBackend(),
      kb: kbStats(),
      time: new Date().toISOString(),
    })
  }
  if (path === '/api/chat') return handleChat(req, res)
  if (path === '/api/kb') return handleKB(req, res)
  if (path === '/api/kb/search') return handleSearch(req, res)
  if (path === '/api/kb/misses') return handleMisses(req, res)
  return json(res, 404, { error: 'unknown api' })
}

// ---- /api/kb —— 知识库可视化管理的读写通道 ----
// GET 返回 { CATS, KB, stats }；PUT 整库保存（管理页「保存」）；POST 单条新增/更新；DELETE 单条删除。
// 保存后服务端立即热重载检索索引，AI 客服下一次提问就感知到变化。
async function handleKB(req, res) {
  if (req.method === 'GET') {
    const { CATS, KB, KB_STATS } = loadKB()
    return json(res, 200, {
      CATS,
      KB,
      stats: {
        ...KB_STATS,
        cats: CATS.map((c) => ({ id: c.id, name: c.name, icon: c.icon, count: KB.filter((d) => d.cat === c.id).length })),
      },
    })
  }

  if (req.method === 'PUT') {
    let body
    try {
      body = await readBody(req, 1024 * 1024)
    } catch (e) {
      return json(res, 400, { error: e.message })
    }
    if (!Array.isArray(body.KB)) return json(res, 400, { error: '缺少 KB 数组' })
    const { KB_STATS } = saveKB(body)
    return json(res, 200, { ok: true, stats: KB_STATS })
  }

  if (req.method === 'POST') {
    let body
    try {
      body = await readBody(req, 256 * 1024)
    } catch (e) {
      return json(res, 400, { error: e.message })
    }
    const { CATS, KB } = loadKB()
    const entry = body.entry || body
    const id = String(entry.id || '').trim()
    if (!id) return json(res, 400, { error: '缺少 id' })
    const idx = KB.findIndex((d) => d.id === id)
    if (idx >= 0) KB[idx] = { ...KB[idx], ...entry, id }
    else KB.push({ ...entry, id })
    const { KB_STATS } = saveKB({ CATS, KB })
    return json(res, 200, { ok: true, stats: KB_STATS })
  }

  if (req.method === 'DELETE') {
    const id = String((req.url || '').split('?')[1] || '')
      .split('&')
      .map((p) => p.split('='))
      .find((p) => p[0] === 'id')?.[1]
    if (!id) return json(res, 400, { error: '缺少 id' })
    const { CATS, KB } = loadKB()
    const next = KB.filter((d) => d.id !== decodeURIComponent(id))
    const { KB_STATS } = saveKB({ CATS, KB: next })
    return json(res, 200, { ok: true, stats: KB_STATS })
  }

  return json(res, 405, { error: '不支持的请求方法' })
}

const args = new Set(process.argv.slice(2))
const apiOnly = args.has('--api-only')

// 记下 pid，方便「停止服务.bat」精确关掉这个后台进程
const PID_FILE = join(HERE, '.server.pid')
try {
  writeFileSync(PID_FILE, String(process.pid))
} catch {
  /* 忽略 */
}
const bye = () => {
  try {
    rmSync(PID_FILE, { force: true })
  } catch {
    /* 忽略 */
  }
  process.exit(0)
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)

const apiServer = makeServer(apiHandler)
apiServer.listen(cfg.apiPort, '127.0.0.1', () => {
  console.log(`[api]  http://127.0.0.1:${cfg.apiPort}/api/health  模型：${cfg.models.join(' → ')}`)
})

if (!apiOnly) {
  const webServer = makeServer((req, res) => {
    if ((req.url || '').startsWith('/api/')) return apiHandler(req, res)
    // 运营侧「更新系统」是独立入口，与乘客端共用静态目录但不共用页面
    const url = (req.url || '').split('?')[0]
    if (url === '/ops' || url === '/ops/') req.url = '/ops.html'
    return Promise.resolve(serveStatic(join(ROOT, 'web', 'dist'), req, res))
  })
  const simServer = makeServer((req, res) => {
    if ((req.url || '').startsWith('/api/')) return apiHandler(req, res)
    return Promise.resolve(serveStatic(join(ROOT, 'simlab', 'dist'), req, res))
  })
  webServer.on('error', (e) => console.warn(`[web] 端口 ${cfg.webPort} 不可用（${e.code}），可能已有 dev server 在跑`))
  simServer.on('error', (e) => console.warn(`[sim] 端口 ${cfg.simPort} 不可用（${e.code}）`))
  apiServer.on('error', (e) => console.warn(`[api] 端口 ${cfg.apiPort} 不可用（${e.code}）`))
  webServer.listen(cfg.webPort, '127.0.0.1', () => console.log(`[web]  http://127.0.0.1:${cfg.webPort}/   「云乘见」`))
  simServer.listen(cfg.simPort, '127.0.0.1', () => console.log(`[sim]  http://127.0.0.1:${cfg.simPort}/   「云智仿」`))
}
