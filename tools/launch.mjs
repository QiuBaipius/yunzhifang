// 一键启动器：不依赖任何对话窗口，双击 bat / 桌面快捷方式就能用
//   node tools/launch.mjs web    起服务并打开「云乘见」
//   node tools/launch.mjs sim    起服务并打开「云智仿」
//   node tools/launch.mjs all    两个都打开
//   node tools/launch.mjs stop   停止后台服务
// 服务是 detached 进程：这个脚本退出后它仍然在跑，关掉 cmd 窗口也不影响。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PID_FILE = join(ROOT, 'server', '.server.pid')
const WEB = 'http://127.0.0.1:5173/'
const SIM = 'http://127.0.0.1:5174/'
const HEALTH = 'http://127.0.0.1:5173/api/health'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function healthy(timeout = 1200) {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeout)
    const r = await fetch(HEALTH, { signal: ac.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

function openUrl(url) {
  // start 是 cmd 内置命令；用 detached 避免把启动器一起挂住
  const p = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
  p.unref()
}

async function ensureServer() {
  if (await healthy()) return true
  const entry = join(ROOT, 'server', 'index.mjs')
  if (!existsSync(join(ROOT, 'web', 'dist', 'index.html'))) {
    console.log('⚠ 还没有构建产物：先执行一次  npm --prefix web run build')
  }
  // 用 cmd 的 start 起一个独立的最小化控制台窗口：它不挂在启动器/本脚本下，
  // 关掉脚本或 cmd 都不影响；想停服务可以点「停止服务.bat」或直接关那个窗口。
  const p = spawn('cmd', ['/c', 'start', '云乘见服务', '/min', process.execPath, entry], {
    detached: true,
    stdio: 'ignore',
    cwd: ROOT,
  })
  p.unref()
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    if (await healthy(800)) return true
  }
  return false
}

function stopServer() {
  if (!existsSync(PID_FILE)) {
    console.log('没有找到运行中的服务（server/.server.pid 不存在）。')
    return
  }
  const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
  if (!pid) {
    console.log('pid 文件内容无效，已删除。')
    rmSync(PID_FILE, { force: true })
    return
  }
  try {
    const p = spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' })
    p.on('exit', (code) => {
      console.log(code === 0 ? `已停止服务（pid ${pid}）。` : `停止失败，pid ${pid} 可能已经退出。`)
      rmSync(PID_FILE, { force: true })
    })
  } catch (e) {
    console.log('停止失败：', e.message)
  }
}

const cmd = (process.argv[2] || 'web').toLowerCase()
if (cmd === 'stop') {
  stopServer()
} else {
  const ok = await ensureServer()
  if (!ok) {
    console.log('✗ 服务启动失败。可以在项目目录手动执行：node server/index.mjs  看报错信息。')
    process.exit(1)
  }
  console.log('✓ 服务已就绪')
  if (cmd === 'web' || cmd === 'all') {
    openUrl(WEB)
    console.log(`  云乘见：${WEB}`)
  }
  if (cmd === 'sim' || cmd === 'all') {
    openUrl(SIM)
    console.log(`  云智仿：${SIM}`)
  }
}
