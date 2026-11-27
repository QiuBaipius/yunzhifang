// 派单 / 拼车核心算法入口（与仿真引擎解耦，可单独测试）
//
// 算法：**可行插入 + 局部重优化**（Cheapest Feasible Insertion + or-opt）
// 实现与文献依据见 services/ridepool.js 顶部注释。
//
// 与旧版「首位乘客绕路增量 + 夹角」规则的关键差别：
//   1) 距离基准：乘客 OD 的最短路（路网最优路径），不是直线距离；
//   2) 约束对象：车上每一位乘客 + 所有已接单未上车的乘客，各自用自己的 OD 预算；
//   3) 行程结构：车辆有多站行程（事件序列），新单插入最优位次，而不是固定「先接新客」；
//   4) 插入后做 or-opt 重排，避免贪心插入造成的短视。
export { insertOrder, evaluatePlan, improvePlan, planKm, POOL_DEFAULTS } from './ridepool.js'

// 拒单原因文案（供 UI 直接展示）
export const REJECT_TEXT = {
  capacity: '车辆满载或位次不够（不允许超员）',
  detour_budget: '拼车后某位乘客的乘车里程会超过其 OD 最优路径的 133%',
  wait_too_long: '预计等待超过 20 分钟',
  no_vehicle: '附近没有可行车辆',
  bad_plan: '行程无解',
}

// 规则口径常量（PRD 规则 3/4/5 的工程化表达）
export const POOL_RULES = {
  detourRatio: 1 / 3, // 每位乘客的绕行预算 = 其 OD 最优路径距离 × 1/3
  waitMaxMin: 20,
  ruleText:
    '车辆行程是一串服务事件（上车/下车）。新订单会枚举插入位次，' +
    '要求车上每位乘客（含新乘客）的预计乘车里程 ≤ 自己的 OD 最优路径距离 × 133%，' +
    '逐段载客数 ≤ 容量，且所有未上车乘客的等待 ≤ 20 分钟；最后按「总里程增加最少」选车。',
}
