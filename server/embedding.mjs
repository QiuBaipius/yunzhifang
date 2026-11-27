// 统一 Embedding / Rerank 服务层（第二十四轮）
//
// 一行切换后端：
//   EMBED_BACKEND=local   本地向量 + 本地重排（默认，离线可用）
//   EMBED_BACKEND=zhipu   智谱 embedding-3 + rerank（需 API 余额）
//   EMBED_BACKEND=http    自建 bge-m3 / bge-reranker-v2-m3 HTTP 服务（OpenAI 兼容）
//
// 配置写在 server/config.local.json 的 embedding 字段，也可以用同名环境变量覆盖。
// 智谱 / 自建服务不可用时自动降级回 local，保证客服永远能用。
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

function loadEmbeddingConfig() {
  let local = {}
  const f = join(HERE, 'config.local.json')
  if (existsSync(f)) {
    try {
      local = JSON.parse(readFileSync(f, 'utf8')).embedding || {}
    } catch { /* 忽略坏配置 */ }
  }
  const env = (k, d) => process.env[k] || local[k] || d
  return {
    backend: env('EMBED_BACKEND', 'local'),
    apiKey: env('GLM_API_KEY', ''),
    embeddingModel: env('EMBED_MODEL', 'embedding-3'),
    rerankModel: env('RERANK_MODEL', 'rerank'),
    baseUrl: env('EMBED_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4'),
    httpBase: env('BGE_BASE_URL', 'http://127.0.0.1:8080/v1'),
    timeout: Number(env('EMBED_TIMEOUT', 3500)),
  }
}

export const EMBED_CFG = loadEmbeddingConfig()

async function post(url, body, headers = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), EMBED_CFG.timeout)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 100)}`)
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

const _embedCache = new Map()
async function remoteEmbed(texts) {
  const key = texts.join('\u0001')
  if (_embedCache.has(key)) return _embedCache.get(key)
  const useZhipu = EMBED_CFG.backend === 'zhipu'
  const url = useZhipu
    ? `${EMBED_CFG.baseUrl}/embeddings`
    : `${EMBED_CFG.httpBase}/embeddings`
  const body = useZhipu
    ? { model: EMBED_CFG.embeddingModel, input: texts }
    : { model: EMBED_CFG.embeddingModel, input: texts }
  const headers = useZhipu ? { Authorization: `Bearer ${EMBED_CFG.apiKey}` } : {}
  const j = await post(url, body, headers)
  const out = (j.data || []).map((d) => d.embedding || d)
  if (!out.length) throw new Error('空向量')
  if (_embedCache.size > 2000) _embedCache.clear()
  _embedCache.set(key, out)
  return out
}

// 余弦相似度（本地向量与远端向量统一口径）
export function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

// 本地兜底向量：2–3 字 n-gram 的 256 维 hashing（bge 风格的稀疏近似）
export function localEmbed(text) {
  const v = new Float64Array(256)
  const t = String(text || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
  for (const seg of t.split(/\s+/)) {
    if (!seg) continue
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const g = seg.slice(i, i + n)
        let h = 0
        for (let k = 0; k < g.length; k++) h = (h * 31 + g.charCodeAt(k)) | 0
        v[(h >>> 0) % 256] += 1
      }
    }
  }
  return v
}

export async function embed(texts) {
  if (EMBED_CFG.backend === 'local') return texts.map(localEmbed)
  try {
    return await remoteEmbed(texts)
  } catch (e) {
    console.warn(`[embed] ${EMBED_CFG.backend} 不可用，降级本地：`, e.message)
    return texts.map(localEmbed)
  }
}

// Rerank：返回按相关度降序的 [{ index, score }]，失败降级为顺序分
export async function rerank(query, documents) {
  if (!documents.length) return []
  if (EMBED_CFG.backend === 'local') {
    const qv = localEmbed(query)
    return documents
      .map((d, index) => ({ index, score: cosine(qv, localEmbed(d)) }))
      .sort((a, b) => b.score - a.score)
  }
  const useZhipu = EMBED_CFG.backend === 'zhipu'
  const url = useZhipu
    ? `${EMBED_CFG.baseUrl}/rerank`
    : `${EMBED_CFG.httpBase}/rerank`
  const headers = useZhipu ? { Authorization: `Bearer ${EMBED_CFG.apiKey}` } : {}
  try {
    const j = await post(url, {
      model: EMBED_CFG.rerankModel,
      query,
      documents,
      top_n: documents.length,
    }, headers)
    const list = j.results || j.data || []
    return list.map((x) => ({ index: Number(x.index) || 0, score: Number(x.relevance_score ?? x.score) || 0 }))
  } catch (e) {
    console.warn(`[rerank] ${EMBED_CFG.backend} 不可用，降级本地：`, e.message)
    const qv = localEmbed(query)
    return documents
      .map((d, index) => ({ index, score: cosine(qv, localEmbed(d)) }))
      .sort((a, b) => b.score - a.score)
  }
}

export function embedBackend() {
  return EMBED_CFG.backend
}
