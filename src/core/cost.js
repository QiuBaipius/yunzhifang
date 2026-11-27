// 运营成本模型（元/车·日）
//
// 结构对齐《城市公共汽电车企业运营成本测算规范》(DB3306/T 068-2024) 与
// 江阴 / 三明 / 仁怀等城市公交成本规制办法：
//
//   日运营成本 = [司机工资 + 车辆折旧 + 车均管理费 + 保险安全费] + 运行里程 × [电耗×电价 + 保养修理 + 其他运营]
//                └──────────────── 固定成本（按在岗时长折算）────────────────┘   └──────────── 里程变动成本 ────────────┘
//
// 其中唯一随仿真变化的自变量是该车当日的运行里程（km），其余均为可查证的固定常数（见 data/config.js 的 COST）。
import { COST, DEMAND } from '../data/config.js'

// 车辆日折旧（8 年直线折旧，残值 0）
export function dailyDepreciation() {
  return COST.vehiclePrice / COST.vehicleLifeYears / 365
}

// 每公里变动成本（元/km）
export function costPerKm() {
  return {
    electricity: COST.kwhPerKm * COST.electricityPrice,
    maintenance: COST.maintenancePerKm,
    other: COST.otherPerKm,
    total: COST.kwhPerKm * COST.electricityPrice + COST.maintenancePerKm + COST.otherPerKm,
  }
}

// 固定成本（元/车·日），不随里程变化
export function fixedCostDaily() {
  return {
    driver: COST.driverDailyWage * COST.driversPerVehicle,
    depreciation: dailyDepreciation(),
    management: COST.dailyManagement,
    insurance: COST.dailyInsurance,
    total:
      COST.driverDailyWage * COST.driversPerVehicle +
      dailyDepreciation() +
      COST.dailyManagement +
      COST.dailyInsurance,
  }
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))

// 单车当日在岗时长占比：增派车中途出场时，固定成本按在岗时长折算（至少按 1 小时计）
export function dutyRatio(onDutyMin, dayMin = DEMAND.dayMin) {
  if (onDutyMin == null) return 1
  const minutes = Math.max(60, onDutyMin)
  return clamp01(minutes / Math.max(1, dayMin))
}

// 单车日运营成本明细
// opts: { km, onDutyMin, dayMin, orders }
export function vehicleDailyCost({ km = 0, onDutyMin = null, dayMin = DEMAND.dayMin, orders = 0 } = {}) {
  const fixed = fixedCostDaily()
  const perKm = costPerKm()
  const ratio = dutyRatio(onDutyMin, dayMin)

  const items = [
    { key: 'driver', label: '司机工资（人车比 1.2）', kind: 'fixed', amount: fixed.driver * ratio },
    { key: 'depreciation', label: `车辆折旧（${(COST.vehiclePrice / 10000).toFixed(0)} 万 / ${COST.vehicleLifeYears} 年）`, kind: 'fixed', amount: fixed.depreciation * ratio },
    { key: 'management', label: '车均管理费用', kind: 'fixed', amount: fixed.management * ratio },
    { key: 'insurance', label: '保险与安全费', kind: 'fixed', amount: fixed.insurance * ratio },
    { key: 'electricity', label: `电费（${(COST.kwhPerKm * 100).toFixed(0)} kWh/100km × ${COST.electricityPrice} 元）`, kind: 'km', amount: km * perKm.electricity, rate: perKm.electricity },
    { key: 'maintenance', label: '保养修理费', kind: 'km', amount: km * perKm.maintenance, rate: perKm.maintenance },
    { key: 'other', label: '其他运营支出', kind: 'km', amount: km * perKm.other, rate: perKm.other },
  ]

  const fixedTotal = items.filter((i) => i.kind === 'fixed').reduce((s, i) => s + i.amount, 0)
  const kmTotal = items.filter((i) => i.kind === 'km').reduce((s, i) => s + i.amount, 0)
  const total = fixedTotal + kmTotal

  return {
    km,
    onDutyMin,
    dutyRatio: ratio,
    items,
    fixed: fixedTotal,
    variable: kmTotal,
    total,
    perKm: km > 0 ? total / km : null,
    perOrder: orders > 0 ? total / orders : null,
  }
}

// 车队合计
export function fleetCost(rows = []) {
  const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0)
  const totalKm = sum((r) => r.km)
  const total = sum((r) => r.cost?.total)
  const revenue = sum((r) => r.revenue)
  return {
    vehicles: rows.length,
    km: totalKm,
    cost: total,
    revenue,
    net: revenue - total,
    perKm: totalKm > 0 ? total / totalKm : null,
    perOrder: sum((r) => r.orders) > 0 ? total / sum((r) => r.orders) : null,
    orders: sum((r) => r.orders),
  }
}

// 公式口径说明（界面直接展示，便于复盘时核对每个常数的来源）
export function costFormula() {
  const fixed = fixedCostDaily()
  const perKm = costPerKm()
  return {
    fixed,
    perKm,
    text:
      `日成本 = 固定 ${fixed.total.toFixed(1)} 元 ` +
      `（司机 ${fixed.driver.toFixed(0)} + 折旧 ${fixed.depreciation.toFixed(1)} + 管理 ${fixed.management.toFixed(0)} + 保险 ${fixed.insurance.toFixed(0)}）` +
      ` + 运行里程 × ${perKm.total.toFixed(3)} 元/km` +
      `（电 ${perKm.electricity.toFixed(3)} + 维保 ${perKm.maintenance.toFixed(2)} + 其他 ${perKm.other.toFixed(2)}）`,
    sources: [
      '《城市公共汽电车企业运营成本测算规范》DB3306/T 068-2024：人工 + 能耗 + 折旧 + 维保 + 保险 + 其他 + 管理',
      '江阴市公交成本规制标准值（元/千公里）：人工 3059.85 / 折旧 1000 / 电 752.42 / 维保 355.23 / 保险 192.28 / 其他 376.23 / 管理 153.41',
      '三明市、仁怀市成本规制办法：驾驶员人车比 1.5:1，其他人员 : 驾驶员 = 0.65',
      '9 座纯电轻客实测百公里电耗 16.4–19.5 kWh（五菱扬光 Pro / 图雅诺 / 瑞风 E3），本工程取 18 kWh',
    ],
  }
}
