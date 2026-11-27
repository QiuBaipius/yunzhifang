#!/usr/bin/env node
// 命令行入口：跑一份场景（默认场景或 JSON 文件）→ 订单 / 车辆 / 轨迹 / 指标 / 摘要
//
//   node scripts/simlab.mjs                       # 用内置默认场景
//   node scripts/simlab.mjs my-scenario.json      # 用场景文件（键名可用中文或英文）
//   node scripts/simlab.mjs my.json --out runs/a  # 指定输出目录
//   node scripts/simlab.mjs -n 16 --seed 21 --step 0.5 --size large
//
// 与 GUI 共用 src/core/runner.js，因此同一份场景在界面和命令行上的结果完全一致。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  kpisObject,
  ordersTable,
  runScenario,
  summaryText,
  toCsv,
  trajectoriesTable,
  vehiclesTable,
} from '../src/core/runner.js'
import { defaultScenario, validateScenario } from '../src/core/scenario.js'

const HELP = `用法：node scripts/simlab.mjs [场景文件.json] [选项]

选项：
  -o, --out <目录>    输出目录（默认 runs/<时间戳>）
  -n, --vehicles <数> 覆盖初始车辆数
      --seed <数>     覆盖仿真随机种子
      --size <规模>   覆盖路网规模（compact / standard / large）
      --step <分钟>   覆盖仿真步长（0.1–1，默认 0.5）
  -q, --quiet         只写文件，不打印摘要
  -h, --help          显示本帮助

输出：orders.csv / vehicles.csv / trajectories.csv / kpis.json / kpis.csv / summary.txt
（输出哪些文件由场景里的“输出”配置决定）`

const MAX_TRACK_ROWS = 120000

function die(msg) {
  console.error(msg)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = { file: null, out: null, quiet: false, help: false, set: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') opts.help = true
    else if (a === '-q' || a === '--quiet') opts.quiet = true
    else if (a === '-o' || a === '--out') opts.out = argv[++i]
    else if (a === '-n' || a === '--vehicles') opts.set.初始车辆 = Number(argv[++i])
    else if (a === '--seed') opts.set.随机种子 = Number(argv[++i])
    else if (a === '--size') opts.set.规模 = argv[++i]
    else if (a === '--step') opts.set.步长 = Number(argv[++i])
    else if (a.startsWith('-')) die(`未知参数：${a}\n\n${HELP}`)
    else if (opts.file) die(`只能指定一个场景文件（已有：${opts.file}）`)
    else opts.file = a
  }
  return opts
}

function loadScenario(file) {
  if (!file) return defaultScenario()
  let text
  try {
    text = readFileSync(resolve(file), 'utf8')
  } catch (e) {
    die(`读不到场景文件 ${file}：${e.message}`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    die(`场景文件不是合法 JSON：${e.message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) die('场景文件顶层必须是一个对象（键值配置）')
  return raw
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(HELP)
    return
  }

  const raw = loadScenario(opts.file)
  const scenario = defaultScenario({
    名称: raw.名称 ?? raw.name,
    说明: raw.说明 ?? raw.description,
    路网: { ...(raw.路网 || raw.network || {}), ...(opts.set.规模 ? { 规模: opts.set.规模 } : {}) },
    需求: raw.需求 || raw.demand || {},
    车队: { ...(raw.车队 || raw.fleet || {}), ...(opts.set.初始车辆 ? { 初始车辆: opts.set.初始车辆 } : {}) },
    调度: raw.调度 || raw.dispatch || {},
    仿真: {
      ...(raw.仿真 || raw.simulation || raw.sim || {}),
      ...(opts.set.随机种子 ? { 随机种子: opts.set.随机种子 } : {}),
      ...(opts.set.步长 ? { 步长: opts.set.步长 } : {}),
    },
    输出: raw.输出 || raw.outputs || raw.output || {},
  })

  const errs = validateScenario(scenario)
  if (errs.length) {
    console.error('场景校验未通过：')
    for (const e of errs) console.error(`  · ${e}`)
    process.exit(1)
  }

  const result = runScenario(scenario)
  const c = result.config
  const dir = opts.out ? resolve(opts.out) : resolve(c.output.dir, stamp())
  mkdirSync(dir, { recursive: true })

  const written = []
  const save = (name, text, bom = false) => {
    writeFileSync(resolve(dir, name), bom ? '\uFEFF' + text : text, 'utf8')
    written.push(name)
  }

  if (c.output.orders) save('orders.csv', toCsv(ordersTable(result)), true)
  if (c.output.vehicles) save('vehicles.csv', toCsv(vehiclesTable(result)), true)
  if (c.output.trajectories) {
    const total = Object.values(result.engine.tracks).reduce((s, t) => s + t.length, 0)
    const stride = Math.max(1, Math.ceil(total / MAX_TRACK_ROWS))
    save('trajectories.csv', toCsv(trajectoriesTable(result, stride)), true)
  }
  if (c.output.kpis) {
    const k = kpisObject(result)
    save('kpis.json', JSON.stringify(k, null, 2) + '\n')
    save('kpis.csv', toCsv([k]), true)
  }
  save('summary.txt', summaryText(result) + '\n')

  if (!opts.quiet) {
    console.log(summaryText(result))
    console.log('')
    console.log(`输出目录：${dir}`)
    console.log(`文件：${written.join(' / ')}`)
  }
}

main()
