// 第二十轮：站台（路侧）模型 —— 由 tools/gen-platforms-r20.mjs 生成，勿手改
//
// 每个公交站拆成「路北 / 路南」或「路东 / 路西」两个站台：站台只服务
// 「靠右行驶时车行方向右手侧正好是这一侧」的车辆，判断规则见 services/platform.js。
// 地铁站按真实出入口拆开，站体本身只作换乘枢纽，不再直接出现在选择列表。

export const STOP_META = {
  m4: {
    side: 'N',
    label: '路北',
    twin: 'm4o'
  },
  m5: {
    side: 'E',
    label: '路东',
    twin: 'm5o'
  },
  m6: {
    side: 'N',
    label: '路北',
    twin: 'm6o'
  },
  m7: {
    side: 'E',
    label: '路东',
    twin: 'm7o'
  },
  m8: {
    side: 'N',
    label: '路北',
    twin: 'm8o'
  },
  m9: {
    side: 'N',
    label: '路北',
    twin: 'm9o'
  },
  b1: {
    side: 'N',
    label: '路北',
    twin: 'b1o'
  },
  b2: {
    side: 'N',
    label: '路北',
    twin: 'b2o'
  },
  b3: {
    side: 'N',
    label: '路北',
    twin: 'b3o'
  },
  b5: {
    side: 'E',
    label: '路东',
    twin: 'b5o'
  },
  b6: {
    side: 'N',
    label: '路北',
    twin: 'b6o'
  },
  b7: {
    side: 'N',
    label: '路北',
    twin: 'b7o'
  },
  b8: {
    side: 'N',
    label: '路北',
    twin: 'b8o'
  },
  b12: {
    side: 'N',
    label: '路北',
    twin: 'b12o'
  },
  b13: {
    side: 'E',
    label: '路东',
    twin: 'b13o'
  },
  b18: {
    side: 'N',
    label: '路北',
    twin: 'b18o'
  },
  b22: {
    side: 'N',
    label: '路北',
    twin: 'b22o'
  },
  b23: {
    side: 'N',
    label: '路北',
    twin: 'b23o'
  },
  b25: {
    side: 'E',
    label: '路东',
    twin: 'b25o'
  },
  b26: {
    side: 'N',
    label: '路北',
    twin: 'b26o'
  },
  b27: {
    side: 'N',
    label: '路北',
    twin: 'b27o'
  },
  b30: {
    side: 'N',
    label: '路北',
    twin: 'b30o'
  },
  b34: {
    side: 'N',
    label: '路北',
    twin: 'b34o'
  },
  b35: {
    side: 'N',
    label: '路北',
    twin: 'b35o'
  },
  b36: {
    side: 'E',
    label: '路东',
    twin: 'b36o'
  },
  b37: {
    side: 'N',
    label: '路北',
    twin: 'b37o'
  },
  b38: {
    side: 'E',
    label: '路东',
    twin: 'b38o'
  },
  b39: {
    side: 'E',
    label: '路东',
    twin: 'b39o'
  },
  b42: {
    side: 'N',
    label: '路北',
    twin: 'b42o'
  },
  b43: {
    side: 'N',
    label: '路北',
    twin: 'b43o'
  },
  b44: {
    side: 'N',
    label: '路北',
    twin: 'b44o'
  },
  b45: {
    side: 'N',
    label: '路北',
    twin: 'b45o'
  },
  b46: {
    side: 'N',
    label: '路北',
    twin: 'b46o'
  },
  b47: {
    side: 'N',
    label: '路北',
    twin: 'b47o'
  },
  b49: {
    side: 'N',
    label: '路北',
    twin: 'b49o'
  },
  b53: {
    side: 'N',
    label: '路北',
    twin: 'b53o'
  },
  b57: {
    side: 'N',
    label: '路北',
    twin: 'b57o'
  },
  b58: {
    side: 'N',
    label: '路北',
    twin: 'b58o'
  },
  b60: {
    side: 'N',
    label: '路北',
    twin: 'b60o'
  },
  b62: {
    side: 'N',
    label: '路北',
    twin: 'b62o'
  },
  b63: {
    side: 'N',
    label: '路北',
    twin: 'b63o'
  },
  b65: {
    side: 'E',
    label: '路东',
    twin: 'b65o'
  },
  b67: {
    side: 'E',
    label: '路东',
    twin: 'b67o'
  },
  b68: {
    side: 'N',
    label: '路北',
    twin: 'b68o'
  },
  b71: {
    side: 'N',
    label: '路北',
    twin: 'b71o'
  },
  b74: {
    side: 'N',
    label: '路北',
    twin: 'b74o'
  },
  b75: {
    side: 'N',
    label: '路北',
    twin: 'b75o'
  },
  b76: {
    side: 'N',
    label: '路北',
    twin: 'b76o'
  },
  b77: {
    side: 'N',
    label: '路北',
    twin: 'b77o'
  },
  b79: {
    side: 'N',
    label: '路北',
    twin: 'b79o'
  },
  b80: {
    side: 'N',
    label: '路北',
    twin: 'b80o'
  },
  b81: {
    side: 'N',
    label: '路北',
    twin: 'b81o'
  },
  b82: {
    side: 'E',
    label: '路东',
    twin: 'b82o'
  },
  b101: {
    side: 'E',
    label: '路东',
    twin: 'b101o'
  },
  b102: {
    side: 'E',
    label: '路东',
    twin: 'b102o'
  },
  b103: {
    side: 'N',
    label: '路北',
    twin: 'b103o'
  },
  x201: {
    side: 'E',
    label: '路东',
    twin: 'x201o'
  },
  x202: {
    side: 'N',
    label: '路北',
    twin: 'x202o'
  },
  x203: {
    side: 'E',
    label: '路东',
    twin: 'x203o'
  },
  x204: {
    side: 'N',
    label: '路北',
    twin: 'x204o'
  },
  x205: {
    side: 'E',
    label: '路东',
    twin: 'x205o'
  },
  n001: {
    side: 'N',
    label: '路北',
    twin: 'n001o'
  },
  n002: {
    side: 'E',
    label: '路东',
    twin: 'n002o'
  },
  n003: {
    side: 'N',
    label: '路北',
    twin: 'n003o'
  },
  n006: {
    hidden: true,
    mergedInto: 'n004'
  },
  n008: {
    side: 'N',
    label: '路北',
    twin: 'n008o'
  },
  n009: {
    side: 'N',
    label: '路北',
    twin: 'n009o'
  },
  n011: {
    side: 'N',
    label: '路北',
    twin: 'n011o'
  },
  n012: {
    side: 'E',
    label: '路东',
    twin: 'n012o'
  },
  n013: {
    side: 'E',
    label: '路东',
    twin: 'n013o'
  },
  n014: {
    side: 'E',
    label: '路东',
    twin: 'n014o'
  },
  n015: {
    side: 'N',
    label: '路北',
    twin: 'n015o'
  },
  n016: {
    side: 'N',
    label: '路北',
    twin: 'n016o'
  },
  n017: {
    side: 'N',
    label: '路北',
    twin: 'n017o'
  },
  n018: {
    side: 'N',
    label: '路北',
    twin: 'n018o'
  },
  n019: {
    side: 'N',
    label: '路北',
    twin: 'n019o'
  },
  n020: {
    side: 'N',
    label: '路北',
    twin: 'n020o'
  },
  n021: {
    side: 'E',
    label: '路东',
    twin: 'n021o'
  },
  n022: {
    side: 'E',
    label: '路东',
    twin: 'n022o'
  },
  n023: {
    side: 'N',
    label: '路北',
    twin: 'n023o'
  },
  n024: {
    side: 'N',
    label: '路北',
    twin: 'n024o'
  },
  n025: {
    side: 'N',
    label: '路北',
    twin: 'n025o'
  },
  n026: {
    side: 'N',
    label: '路北',
    twin: 'n026o'
  },
  n028: {
    side: 'E',
    label: '路东',
    twin: 'n028o'
  },
  n029: {
    side: 'N',
    label: '路北',
    twin: 'n029o'
  },
  n030: {
    side: 'E',
    label: '路东',
    twin: 'n030o'
  },
  n031: {
    side: 'N',
    label: '路北',
    twin: 'n031o'
  },
  n032: {
    side: 'E',
    label: '路东',
    twin: 'n032o'
  },
  n033: {
    side: 'E',
    label: '路东',
    twin: 'n033o'
  },
  n034: {
    side: 'N',
    label: '路北',
    twin: 'n034o'
  },
  n035: {
    side: 'N',
    label: '路北',
    twin: 'n035o'
  },
  n036: {
    side: 'E',
    label: '路东',
    twin: 'n036o'
  },
  n037: {
    side: 'N',
    label: '路北',
    twin: 'n037o'
  },
  n038: {
    side: 'N',
    label: '路北',
    twin: 'n038o'
  },
  n039: {
    side: 'N',
    label: '路北',
    twin: 'n039o'
  },
  n042: {
    side: 'E',
    label: '路东',
    twin: 'n042o'
  },
  n043: {
    side: 'N',
    label: '路北',
    twin: 'n043o'
  },
  n044: {
    side: 'N',
    label: '路北',
    twin: 'n044o'
  },
  n047: {
    side: 'N',
    label: '路北',
    twin: 'n047o'
  },
  n048: {
    side: 'E',
    label: '路东',
    twin: 'n048o'
  },
  n049: {
    side: 'N',
    label: '路北',
    twin: 'n049o'
  },
  n050: {
    side: 'E',
    label: '路东',
    twin: 'n050o'
  },
  n051: {
    side: 'E',
    label: '路东',
    twin: 'n051o'
  },
  n052: {
    side: 'E',
    label: '路东',
    twin: 'n052o'
  },
  n053: {
    side: 'E',
    label: '路东',
    twin: 'n053o'
  },
  n054: {
    side: 'N',
    label: '路北',
    twin: 'n054o'
  },
  n055: {
    side: 'N',
    label: '路北',
    twin: 'n055o'
  },
  n056: {
    side: 'N',
    label: '路北',
    twin: 'n056o'
  },
  n057: {
    side: 'N',
    label: '路北',
    twin: 'n057o'
  },
  n058: {
    side: 'N',
    label: '路北',
    twin: 'n058o'
  },
  n060: {
    side: 'N',
    label: '路北',
    twin: 'n060o'
  },
  n061: {
    merged: true,
    base: 'n059',
    label: 'B1口',
    side: 'N'
  },
  n062: {
    side: 'E',
    label: '路东',
    twin: 'n062o'
  },
  n063: {
    side: 'N',
    label: '路北',
    twin: 'n063o'
  },
  n064: {
    side: 'E',
    label: '路东',
    twin: 'n064o'
  },
  n065: {
    side: 'N',
    label: '路北',
    twin: 'n065o'
  },
  n066: {
    side: 'N',
    label: '路北',
    twin: 'n066o'
  },
  n067: {
    side: 'E',
    label: '路东',
    twin: 'n067o'
  },
  n068: {
    side: 'N',
    label: '路北',
    twin: 'n068o'
  },
  n069: {
    side: 'E',
    label: '路东',
    twin: 'n069o'
  },
  n070: {
    side: 'N',
    label: '路北',
    twin: 'n070o'
  },
  n071: {
    side: 'E',
    label: '路东',
    twin: 'n071o'
  },
  n072: {
    side: 'E',
    label: '路东',
    twin: 'n072o'
  },
  n073: {
    side: 'E',
    label: '路东',
    twin: 'n073o'
  },
  n074: {
    side: 'N',
    label: '路北',
    twin: 'n074o'
  },
  n075: {
    side: 'N',
    label: '路北',
    twin: 'n075o'
  },
  n076: {
    side: 'N',
    label: '路北',
    twin: 'n076o'
  },
  n077: {
    side: 'E',
    label: '路东',
    twin: 'n077o'
  },
  n078: {
    side: 'E',
    label: '路东',
    twin: 'n078o'
  },
  n079: {
    side: 'N',
    label: '路北',
    twin: 'n079o'
  },
  n080: {
    side: 'E',
    label: '路东',
    twin: 'n080o'
  },
  n081: {
    side: 'N',
    label: '路北',
    twin: 'n081o'
  },
  n082: {
    side: 'N',
    label: '路北',
    twin: 'n082o'
  },
  n083: {
    side: 'N',
    label: '路北',
    twin: 'n083o'
  },
  n084: {
    side: 'N',
    label: '路北',
    twin: 'n084o'
  },
  n089: {
    side: 'N',
    label: '路北',
    twin: 'n089o'
  },
  n088: {
    side: 'E',
    label: '路东',
    twin: 'n088o'
  },
  n087: {
    side: 'E',
    label: '路东',
    twin: 'n087o'
  },
  n086: {
    side: 'E',
    label: '路东',
    twin: 'n086o'
  },
  n085: {
    side: 'N',
    label: '路北',
    twin: 'n085o'
  },
  m1: {
    station: true,
    base: '学苑广场',
    side: 'N',
    label: null
  },
  m2: {
    station: true,
    base: '海事大学',
    side: 'N',
    label: null
  },
  m3: {
    station: true,
    base: '黑石礁',
    side: 'E',
    label: null
  },
  m10: {
    station: true,
    base: '大医二院',
    side: 'N',
    label: null
  },
  n027: {
    station: true,
    base: '河口',
    side: 'N',
    label: null
  },
  n059: {
    station: true,
    base: '七贤岭',
    side: 'N',
    label: null
  },
  n007: {
    station: true,
    base: '蔡大岭',
    side: 'E',
    label: null
  },
  n005: {
    hidden: true,
    mergedInto: 'n004'
  }
}

export const PLATFORM_EXTRA = [
  { id: 'm4o', name: "文萃街", lng: 121.534705, lat: 38.87954, x: 129.86, y: 137.89, type: 'both', base: 'm4', side: 'S', label: '路南' },
  { id: 'm5o', name: "理工大学", lng: 121.526507, lat: 38.87827, x: 101.44, y: 143.48, type: 'both', base: 'm5', side: 'W', label: '路西' },
  { id: 'm6o', name: "数码广场", lng: 121.54503, lat: 38.8838, x: 165.65, y: 119.06, type: 'both', base: 'm6', side: 'S', label: '路南' },
  { id: 'm7o', name: "学子街", lng: 121.517876, lat: 38.87739, x: 71.52000000000001, y: 147.37, type: 'both', base: 'm7', side: 'W', label: '路西' },
  { id: 'm8o', name: "高家村", lng: 121.552781, lat: 38.89032, x: 192.52, y: 90.22999999999999, type: 'both', base: 'm8', side: 'S', label: '路南' },
  { id: 'm9o', name: "西南路", lng: 121.561981, lat: 38.89578, x: 224.41, y: 66.08999999999999, type: 'both', base: 'm9', side: 'S', label: '路南' },
  { id: 'b1o', name: "轻工学校", lng: 121.541658, lat: 38.87375, x: 153.96, y: 163.48, type: 'both', base: 'b1', side: 'S', label: '路南' },
  { id: 'b2o', name: "海事大学东", lng: 121.538556, lat: 38.87062, x: 143.21, y: 177.32999999999998, type: 'both', base: 'b2', side: 'S', label: '路南' },
  { id: 'b3o', name: "科技创业大厦", lng: 121.5377, lat: 38.86966, x: 140.24, y: 181.59, type: 'both', base: 'b3', side: 'S', label: '路南' },
  { id: 'b5o', name: "凌水路南", lng: 121.534769, lat: 38.87266, x: 130.08, y: 168.29, type: 'both', base: 'b5', side: 'W', label: '路西' },
  { id: 'b6o', name: "凌水路", lng: 121.534232, lat: 38.87466, x: 128.22, y: 159.48, type: 'both', base: 'b6', side: 'S', label: '路南' },
  { id: 'b7o', name: "杨树街", lng: 121.535709, lat: 38.87642, x: 133.34, y: 151.67, type: 'both', base: 'b7', side: 'S', label: '路南' },
  { id: 'b8o', name: "杨树南街", lng: 121.542558, lat: 38.87826, x: 157.08, y: 143.54999999999998, type: 'both', base: 'b8', side: 'S', label: '路南' },
  { id: 'b12o', name: "育明高中", lng: 121.538833, lat: 38.87943, x: 144.17, y: 138.38, type: 'both', base: 'b12', side: 'S', label: '路南' },
  { id: 'b13o', name: "东北财经大学", lng: 121.546968, lat: 38.87858, x: 172.37, y: 142.13, type: 'both', base: 'b13', side: 'W', label: '路西' },
  { id: 'b18o', name: "软件园双语学校", lng: 121.541663, lat: 38.8827, x: 153.98, y: 123.92999999999999, type: 'both', base: 'b18', side: 'S', label: '路南' },
  { id: 'b22o', name: "万达广场", lng: 121.532239, lat: 38.86269, x: 121.31, y: 212.4, type: 'both', base: 'b22', side: 'S', label: '路南' },
  { id: 'b23o', name: "万达广场(高新店)", lng: 121.531685, lat: 38.86238, x: 119.39, y: 213.75, type: 'both', base: 'b23', side: 'S', label: '路南' },
  { id: 'b25o', name: "尚水街", lng: 121.542494, lat: 38.86074, x: 156.86, y: 221.02, type: 'both', base: 'b25', side: 'W', label: '路西' },
  { id: 'b26o', name: "经贸学校", lng: 121.550704, lat: 38.881, x: 185.32, y: 131.41, type: 'both', base: 'b26', side: 'S', label: '路南' },
  { id: 'b27o', name: "善水街", lng: 121.534472, lat: 38.86096, x: 129.05, y: 220.06, type: 'both', base: 'b27', side: 'S', label: '路南' },
  { id: 'b30o', name: "敬贤街", lng: 121.524984, lat: 38.86607, x: 96.16, y: 197.45, type: 'both', base: 'b30', side: 'S', label: '路南' },
  { id: 'b34o', name: "凌水镇", lng: 121.523025, lat: 38.87707, x: 89.37, y: 148.82, type: 'both', base: 'b34', side: 'S', label: '路南' },
  { id: 'b35o', name: "七院", lng: 121.522341, lat: 38.87698, x: 87, y: 149.22, type: 'both', base: 'b35', side: 'S', label: '路南' },
  { id: 'b36o', name: "仁水街", lng: 121.54368, lat: 38.85824, x: 160.97, y: 232.08, type: 'both', base: 'b36', side: 'W', label: '路西' },
  { id: 'b37o', name: "学子街", lng: 121.522223, lat: 38.86758, x: 86.59, y: 190.78, type: 'both', base: 'b37', side: 'S', label: '路南' },
  { id: 'b38o', name: "软件园", lng: 121.541476, lat: 38.88725, x: 153.33, y: 103.8, type: 'both', base: 'b38', side: 'W', label: '路西' },
  { id: 'b39o', name: "七贤路东", lng: 121.534901, lat: 38.85814, x: 130.54, y: 232.49, type: 'both', base: 'b39', side: 'W', label: '路西' },
  { id: 'b42o', name: "尖山街", lng: 121.556194, lat: 38.8814, x: 204.35, y: 129.65, type: 'both', base: 'b42', side: 'S', label: '路南' },
  { id: 'b43o', name: "龙湖舜山府售楼处", lng: 121.519904, lat: 38.87068, x: 78.55, y: 177.07999999999998, type: 'both', base: 'b43', side: 'S', label: '路南' },
  { id: 'b44o', name: "黑石礁", lng: 121.559912, lat: 38.87604, x: 217.24, y: 153.35, type: 'both', base: 'b44', side: 'S', label: '路南' },
  { id: 'b45o', name: "东软信息学院", lng: 121.533629, lat: 38.88749, x: 126.13, y: 102.74, type: 'both', base: 'b45', side: 'S', label: '路南' },
  { id: 'b46o', name: "燕南街", lng: 121.532631, lat: 38.88744, x: 122.67, y: 102.97, type: 'both', base: 'b46', side: 'S', label: '路南' },
  { id: 'b47o', name: "国际新城", lng: 121.549011, lat: 38.88698, x: 179.45, y: 104.99, type: 'both', base: 'b47', side: 'S', label: '路南' },
  { id: 'b49o', name: "理工大学北门", lng: 121.529726, lat: 38.88695, x: 112.6, y: 105.13, type: 'both', base: 'b49', side: 'S', label: '路南' },
  { id: 'b53o', name: "新新广场", lng: 121.527413, lat: 38.88664, x: 104.58, y: 106.47999999999999, type: 'both', base: 'b53', side: 'S', label: '路南' },
  { id: 'b57o', name: "理工西门建行", lng: 121.526117, lat: 38.88654, x: 100.09, y: 106.92999999999999, type: 'both', base: 'b57', side: 'S', label: '路南' },
  { id: 'b58o', name: "软件园路", lng: 121.550629, lat: 38.88829, x: 185.06, y: 99.19999999999999, type: 'both', base: 'b58', side: 'S', label: '路南' },
  { id: 'b60o', name: "大连理工大学", lng: 121.524802, lat: 38.88629, x: 95.53, y: 108.03, type: 'both', base: 'b60', side: 'S', label: '路南' },
  { id: 'b62o', name: "凌滨路", lng: 121.544407, lat: 38.85396, x: 163.49, y: 251, type: 'both', base: 'b62', side: 'S', label: '路南' },
  { id: 'b63o', name: "星海公园", lng: 121.563394, lat: 38.87787, x: 229.31, y: 145.26, type: 'both', base: 'b63', side: 'S', label: '路南' },
  { id: 'b65o', name: "海州街", lng: 121.562442, lat: 38.88035, x: 226.01, y: 134.29, type: 'both', base: 'b65', side: 'W', label: '路西' },
  { id: 'b67o', name: "富华街", lng: 121.561421, lat: 38.8831, x: 222.47, y: 122.14, type: 'both', base: 'b67', side: 'W', label: '路西' },
  { id: 'b68o', name: "星海浴场", lng: 121.564652, lat: 38.87773, x: 233.67, y: 145.87, type: 'both', base: 'b68', side: 'S', label: '路南' },
  { id: 'b71o', name: "孙家沟", lng: 121.560374, lat: 38.88569, x: 218.84, y: 110.67, type: 'both', base: 'b71', side: 'S', label: '路南' },
  { id: 'b74o', name: "龙江市场", lng: 121.56156, lat: 38.88598, x: 222.95, y: 109.42, type: 'both', base: 'b74', side: 'S', label: '路南' },
  { id: 'b75o', name: "星海公园", lng: 121.566588, lat: 38.87903, x: 240.38, y: 140.13, type: 'both', base: 'b75', side: 'S', label: '路南' },
  { id: 'b76o', name: "徐州街", lng: 121.560051, lat: 38.88852, x: 217.72, y: 98.17, type: 'both', base: 'b76', side: 'S', label: '路南' },
  { id: 'b77o', name: "常州街", lng: 121.562944, lat: 38.88742, x: 227.75, y: 103.06, type: 'both', base: 'b77', side: 'S', label: '路南' },
  { id: 'b79o', name: "连山街", lng: 121.567104, lat: 38.8855, x: 242.17, y: 111.50999999999999, type: 'both', base: 'b79', side: 'S', label: '路南' },
  { id: 'b80o', name: "知邻园", lng: 121.557204, lat: 38.89373, x: 207.85, y: 75.14, type: 'both', base: 'b80', side: 'S', label: '路南' },
  { id: 'b81o', name: "龙江路", lng: 121.564488, lat: 38.88946, x: 233.1, y: 94.03999999999999, type: 'both', base: 'b81', side: 'S', label: '路南' },
  { id: 'b82o', name: "莱州街", lng: 121.562367, lat: 38.89361, x: 225.75, y: 75.66, type: 'both', base: 'b82', side: 'W', label: '路西' },
  { id: 'b101o', name: "大连海洋大学", lng: 121.557556, lat: 38.86996, x: 209.07, y: 180.23, area: 'a1', type: 'both', base: 'b101', side: 'W', label: '路西' },
  { id: 'b102o', name: "IT家园", lng: 121.499113, lat: 38.88778, x: 6.48, y: 101.47, area: 'a1', type: 'both', base: 'b102', side: 'W', label: '路西' },
  { id: 'b103o', name: "金百合三期", lng: 121.498037, lat: 38.87822, x: 2.75, y: 143.72, area: 'a1', type: 'both', base: 'b103', side: 'S', label: '路南' },
  { id: 'x201o', name: "枫峪园", lng: 121.493652, lat: 38.8481, x: -12.450000000000001, y: 276.89, area: 'a2', type: 'both', base: 'x201', side: 'W', label: '路西' },
  { id: 'x202o', name: "桃峪园", lng: 121.47883, lat: 38.8509, x: -63.83, y: 264.5, area: 'a2', type: 'both', base: 'x202', side: 'S', label: '路南' },
  { id: 'x203o', name: "桃峪园三期", lng: 121.496055, lat: 38.85574, x: -4.12, y: 243.11, area: 'a2', type: 'both', base: 'x203', side: 'W', label: '路西' },
  { id: 'x204o', name: "海创半山花园", lng: 121.505324, lat: 38.85678, x: 28.01, y: 238.5, area: 'a2', type: 'both', base: 'x204', side: 'S', label: '路南' },
  { id: 'x205o', name: "小平岛中心广场", lng: 121.501672, lat: 38.83213, x: 15.35, y: 347.53, area: 'a2', type: 'both', base: 'x205', side: 'W', label: '路西' },
  { id: 'n001o', name: "普罗旺斯", lng: 121.485618, lat: 38.85304, x: -40.3, y: 255.07, area: 'a2', type: 'both', base: 'n001', side: 'S', label: '路南' },
  { id: 'n002o', name: "桃峪园一期", lng: 121.485523, lat: 38.85272, x: -40.63, y: 256.49, area: 'a2', type: 'both', base: 'n002', side: 'W', label: '路西' },
  { id: 'n003o', name: "信华信软件园", lng: 121.486123, lat: 38.85314, x: -38.55, y: 254.63, area: 'a2', type: 'both', base: 'n003', side: 'S', label: '路南' },
  { id: 'n006o', name: "蔡大岭轻轨站", lng: 121.495201, lat: 38.85099, x: -7.08, y: 264.12, area: 'a2', type: 'both', base: 'n006', side: 'S', label: '路南' },
  { id: 'n008o', name: "小平岛", lng: 121.497319, lat: 38.83154, x: 0.26, y: 350.1, area: 'a2', type: 'both', base: 'n008', side: 'S', label: '路南' },
  { id: 'n009o', name: "迎宾广场", lng: 121.499953, lat: 38.87899, x: 9.39, y: 140.29999999999998, area: 'a1', type: 'both', base: 'n009', side: 'S', label: '路南' },
  { id: 'n011o', name: "百合山庄", lng: 121.507531, lat: 38.87755, x: 35.66, y: 146.67, area: 'a1', type: 'both', base: 'n011', side: 'S', label: '路南' },
  { id: 'n012o', name: "聚贤路", lng: 121.508893, lat: 38.85667, x: 40.379999999999995, y: 239, area: 'a2', type: 'both', base: 'n012', side: 'W', label: '路西' },
  { id: 'n013o', name: "希贤街", lng: 121.509527, lat: 38.85469, x: 42.58, y: 247.74, area: 'a2', type: 'both', base: 'n013', side: 'W', label: '路西' },
  { id: 'n014o', name: "聚贤中街", lng: 121.50953, lat: 38.85393, x: 42.589999999999996, y: 251.12, area: 'a2', type: 'both', base: 'n014', side: 'W', label: '路西' },
  { id: 'n015o', name: "河口软件园", lng: 121.510035, lat: 38.85022, x: 44.34, y: 267.54, area: 'a2', type: 'both', base: 'n015', side: 'S', label: '路南' },
  { id: 'n016o', name: "小平岛前", lng: 121.510095, lat: 38.84307, x: 44.55, y: 299.15, area: 'a2', type: 'both', base: 'n016', side: 'S', label: '路南' },
  { id: 'n017o', name: "北河口", lng: 121.510358, lat: 38.84308, x: 45.46, y: 299.11, area: 'a2', type: 'both', base: 'n017', side: 'S', label: '路南' },
  { id: 'n018o', name: "凌奥街", lng: 121.512504, lat: 38.88247, x: 52.9, y: 124.94999999999999, area: 'a1', type: 'both', base: 'n018', side: 'S', label: '路南' },
  { id: 'n019o', name: "任贤街", lng: 121.513237, lat: 38.85087, x: 55.44, y: 264.67, area: 'a2', type: 'both', base: 'n019', side: 'S', label: '路南' },
  { id: 'n020o', name: "博广路西", lng: 121.513335, lat: 38.8964, x: 55.78, y: 63.35, area: 'a1', type: 'both', base: 'n020', side: 'S', label: '路南' },
  { id: 'n021o', name: "凌秀小区东侧鑫辰便利店", lng: 121.513182, lat: 38.87824, x: 55.25, y: 143.62, area: 'a1', type: 'both', base: 'n021', side: 'W', label: '路西' },
  { id: 'n022o', name: "大有恬园", lng: 121.513488, lat: 38.87871, x: 56.309999999999995, y: 141.57, area: 'a1', type: 'both', base: 'n022', side: 'W', label: '路西' },
  { id: 'n023o', name: "大有文园", lng: 121.514033, lat: 38.88211, x: 58.2, y: 126.50999999999999, area: 'a1', type: 'both', base: 'n023', side: 'S', label: '路南' },
  { id: 'n024o', name: "河口枢纽站", lng: 121.514697, lat: 38.84302, x: 60.5, y: 299.35, area: 'a2', type: 'both', base: 'n024', side: 'S', label: '路南' },
  { id: 'n025o', name: "理工西门", lng: 121.514746, lat: 38.8852, x: 60.67, y: 112.86999999999999, area: 'a1', type: 'both', base: 'n025', side: 'S', label: '路南' },
  { id: 'n026o', name: "河口湾", lng: 121.514818, lat: 38.83994, x: 60.92, y: 312.96, area: 'a2', type: 'both', base: 'n026', side: 'S', label: '路南' },
  { id: 'n028o', name: "爱贤街", lng: 121.515421, lat: 38.85421, x: 63.01, y: 249.87, area: 'a2', type: 'both', base: 'n028', side: 'W', label: '路西' },
  { id: 'n029o', name: "知方楼(机械学院)", lng: 121.515874, lat: 38.88151, x: 64.58, y: 129.18, area: 'a1', type: 'both', base: 'n029', side: 'S', label: '路南' },
  { id: 'n030o', name: "柒贤贡院", lng: 121.515646, lat: 38.85219, x: 63.79, y: 258.83, area: 'a2', type: 'both', base: 'n030', side: 'W', label: '路西' },
  { id: 'n031o', name: "云计算中心", lng: 121.517108, lat: 38.86496, x: 68.86, y: 202.37, area: 'a2', type: 'both', base: 'n031', side: 'S', label: '路南' },
  { id: 'n032o', name: "九成投资集团", lng: 121.517172, lat: 38.85649, x: 69.08, y: 239.81, area: 'a2', type: 'both', base: 'n032', side: 'W', label: '路西' },
  { id: 'n033o', name: "广贤路", lng: 121.51718, lat: 38.85877, x: 69.11, y: 229.71, area: 'a2', type: 'both', base: 'n033', side: 'W', label: '路西' },
  { id: 'n034o', name: "山海一家", lng: 121.517659, lat: 38.84663, x: 70.77, y: 283.42, area: 'a2', type: 'both', base: 'n034', side: 'S', label: '路南' },
  { id: 'n035o', name: "博智街", lng: 121.517899, lat: 38.89829, x: 71.6, y: 54.99, area: 'a1', type: 'both', base: 'n035', side: 'S', label: '路南' },
  { id: 'n036o', name: "三丰集团", lng: 121.518219, lat: 38.86122, x: 72.71000000000001, y: 218.89, area: 'a2', type: 'both', base: 'n036', side: 'W', label: '路西' },
  { id: 'n037o', name: "大华锦绣华城", lng: 121.518588, lat: 38.89888, x: 73.99, y: 52.35, area: 'a1', type: 'both', base: 'n037', side: 'S', label: '路南' },
  { id: 'n038o', name: "知远楼(材料学院)", lng: 121.518608, lat: 38.88007, x: 74.06, y: 135.54999999999998, area: 'a1', type: 'both', base: 'n038', side: 'S', label: '路南' },
  { id: 'n039o', name: "化工学院", lng: 121.51864, lat: 38.88484, x: 74.17, y: 114.47, area: 'a1', type: 'both', base: 'n039', side: 'S', label: '路南' },
  { id: 'n042o', name: "高能街", lng: 121.520316, lat: 38.86342, x: 79.98, y: 209.14, area: 'a2', type: 'both', base: 'n042', side: 'W', label: '路西' },
  { id: 'n043o', name: "广贤路", lng: 121.520778, lat: 38.8515, x: 81.58, y: 261.88, area: 'a2', type: 'both', base: 'n043', side: 'S', label: '路南' },
  { id: 'n044o', name: "中国华录", lng: 121.52162, lat: 38.85219, x: 84.5, y: 258.8, area: 'a2', type: 'both', base: 'n044', side: 'S', label: '路南' },
  { id: 'n047o', name: "高能街广场", lng: 121.523201, lat: 38.86188, x: 89.98, y: 215.98, area: 'a2', type: 'both', base: 'n047', side: 'S', label: '路南' },
  { id: 'n048o', name: "经贸高级中学", lng: 121.523686, lat: 38.88892, x: 91.66000000000001, y: 96.4, area: 'a1', type: 'both', base: 'n048', side: 'W', label: '路西' },
  { id: 'n049o', name: "庙岭", lng: 121.524808, lat: 38.89348, x: 95.55, y: 76.25999999999999, area: 'a1', type: 'both', base: 'n049', side: 'S', label: '路南' },
  { id: 'n050o', name: "华信软件大厦", lng: 121.525093, lat: 38.85444, x: 96.54, y: 248.88, area: 'a2', type: 'both', base: 'n050', side: 'W', label: '路西' },
  { id: 'n051o', name: "信达街(附28路站牌处)", lng: 121.525114, lat: 38.85459, x: 96.61, y: 248.21, area: 'a2', type: 'both', base: 'n051', side: 'W', label: '路西' },
  { id: 'n052o', name: "红凌南路", lng: 121.52531, lat: 38.8967, x: 97.29, y: 62.01, area: 'a1', type: 'both', base: 'n052', side: 'W', label: '路西' },
  { id: 'n053o', name: "综合教学1号楼", lng: 121.525359, lat: 38.88266, x: 97.46000000000001, y: 124.07, area: 'a1', type: 'both', base: 'n053', side: 'W', label: '路西' },
  { id: 'n054o', name: "理工北门外", lng: 121.52584, lat: 38.87974, x: 99.13, y: 137.01, area: 'a1', type: 'both', base: 'n054', side: 'S', label: '路南' },
  { id: 'n055o', name: "信达街", lng: 121.525864, lat: 38.85476, x: 99.21, y: 247.43, area: 'a2', type: 'both', base: 'n055', side: 'S', label: '路南' },
  { id: 'n056o', name: "燕知街西", lng: 121.526293, lat: 38.89412, x: 100.7, y: 73.41, area: 'a1', type: 'both', base: 'n056', side: 'S', label: '路南' },
  { id: 'n057o', name: "第二教学馆", lng: 121.52668, lat: 38.88073, x: 102.04, y: 132.64, area: 'a1', type: 'both', base: 'n057', side: 'S', label: '路南' },
  { id: 'n058o', name: "七贤岭", lng: 121.527352, lat: 38.85684, x: 104.37, y: 238.26999999999998, area: 'a2', type: 'both', base: 'n058', side: 'S', label: '路南' },
  { id: 'n060o', name: "高新园区", lng: 121.528001, lat: 38.85748, x: 106.62, y: 235.43, area: 'a2', type: 'both', base: 'n060', side: 'S', label: '路南' },
  { id: 'n061o', name: "七贤岭地铁站", lng: 121.528249, lat: 38.85764, x: 107.48, y: 234.73, area: 'a2', type: 'both', base: 'n061', side: 'S', label: '路南' },
  { id: 'n062o', name: "高新街", lng: 121.528411, lat: 38.86029, x: 108.04, y: 222.98, area: 'a2', type: 'both', base: 'n062', side: 'W', label: '路西' },
  { id: 'n063o', name: "理工校部音乐喷泉", lng: 121.529201, lat: 38.87822, x: 110.78, y: 143.73, area: 'a1', type: 'both', base: 'n063', side: 'S', label: '路南' },
  { id: 'n064o', name: "大工商店(校史馆)", lng: 121.529671, lat: 38.88024, x: 112.41000000000001, y: 134.79, area: 'a1', type: 'both', base: 'n064', side: 'W', label: '路西' },
  { id: 'n065o', name: "体育场", lng: 121.530967, lat: 38.87825, x: 116.9, y: 143.57, area: 'a1', type: 'both', base: 'n065', side: 'S', label: '路南' },
  { id: 'n066o', name: "燕知街", lng: 121.531797, lat: 38.89437, x: 119.78, y: 72.32, area: 'a1', type: 'both', base: 'n066', side: 'S', label: '路南' },
  { id: 'n067o', name: "理工东门", lng: 121.532343, lat: 38.87846, x: 121.67, y: 142.65, area: 'a1', type: 'both', base: 'n067', side: 'W', label: '路西' },
  { id: 'n068o', name: "在水一方", lng: 121.532813, lat: 38.87534, x: 123.3, y: 156.46, area: 'a1', type: 'both', base: 'n068', side: 'S', label: '路南' },
  { id: 'n069o', name: "工训中心", lng: 121.532836, lat: 38.87945, x: 123.38000000000001, y: 138.29, area: 'a1', type: 'both', base: 'n069', side: 'W', label: '路西' },
  { id: 'n070o', name: "锦辉高新店", lng: 121.534102, lat: 38.86539, x: 127.77, y: 200.45, area: 'a1', type: 'both', base: 'n070', side: 'S', label: '路南' },
  { id: 'n071o', name: "风洞实验室", lng: 121.535288, lat: 38.88105, x: 131.88, y: 131.19, area: 'a1', type: 'both', base: 'n071', side: 'W', label: '路西' },
  { id: 'n072o', name: "数码路北", lng: 121.536857, lat: 38.89405, x: 137.32, y: 73.72, area: 'a1', type: 'both', base: 'n072', side: 'W', label: '路西' },
  { id: 'n073o', name: "东软信息学院东", lng: 121.539064, lat: 38.8906, x: 144.97, y: 88.96, area: 'a1', type: 'both', base: 'n073', side: 'W', label: '路西' },
  { id: 'n074o', name: "亿海贤府", lng: 121.539633, lat: 38.85417, x: 146.94, y: 250.04999999999998, area: 'a1', type: 'both', base: 'n074', side: 'S', label: '路南' },
  { id: 'n075o', name: "七贤东路南", lng: 121.539979, lat: 38.85401, x: 148.14, y: 250.76, area: 'a1', type: 'both', base: 'n075', side: 'S', label: '路南' },
  { id: 'n076o', name: "学苑广场", lng: 121.548085, lat: 38.87552, x: 176.24, y: 155.64, area: 'a1', type: 'both', base: 'n076', side: 'S', label: '路南' },
  { id: 'n077o', name: "黑石礁街", lng: 121.556638, lat: 38.8722, x: 205.89000000000001, y: 170.32, area: 'a1', type: 'both', base: 'n077', side: 'W', label: '路西' },
  { id: 'n078o', name: "黑石礁", lng: 121.556693, lat: 38.87325, x: 206.08, y: 165.7, area: 'a1', type: 'both', base: 'n078', side: 'W', label: '路西' },
  { id: 'n079o', name: "沙区检察院", lng: 121.561955, lat: 38.90096, x: 224.32, y: 43.190000000000005, area: 'a1', type: 'both', base: 'n079', side: 'S', label: '路南' },
  { id: 'n080o', name: "丰台街", lng: 121.561894, lat: 38.89921, x: 224.11, y: 50.9, area: 'a1', type: 'both', base: 'n080', side: 'W', label: '路西' },
  { id: 'n081o', name: "南沙街西", lng: 121.563492, lat: 38.9016, x: 229.65, y: 40.330000000000005, area: 'a1', type: 'both', base: 'n081', side: 'S', label: '路南' },
  { id: 'n082o', name: "净水厂", lng: 121.563691, lat: 38.89686, x: 230.34, y: 61.300000000000004, area: 'a1', type: 'both', base: 'n082', side: 'S', label: '路南' },
  { id: 'n083o', name: "台山村", lng: 121.567742, lat: 38.89832, x: 244.38, y: 54.84, area: 'a1', type: 'both', base: 'n083', side: 'S', label: '路南' },
  { id: 'n084o', name: "南沙街", lng: 121.573655, lat: 38.90089, x: 264.88, y: 43.5, area: 'a1', type: 'both', base: 'n084', side: 'S', label: '路南' },
  { id: 'n089o', name: "弄涛街", lng: 121.5127, lat: 38.83771, x: 53.58, y: 322.84, area: 'a2', type: 'both', base: 'n089', side: 'S', label: '路南' },
  { id: 'n088o', name: "疗养院", lng: 121.508065, lat: 38.83998, x: 37.51, y: 312.82, area: 'a2', type: 'both', base: 'n088', side: 'W', label: '路西' },
  { id: 'n087o', name: "听海街西", lng: 121.503729, lat: 38.83804, x: 22.48, y: 321.37, area: 'a2', type: 'both', base: 'n087', side: 'W', label: '路西' },
  { id: 'n086o', name: "邻海园", lng: 121.503074, lat: 38.83505, x: 20.21, y: 334.6, area: 'a2', type: 'both', base: 'n086', side: 'W', label: '路西' },
  { id: 'n085o', name: "小平岛路", lng: 121.507323, lat: 38.83425, x: 34.94, y: 338.12, area: 'a2', type: 'both', base: 'n085', side: 'S', label: '路南' },
  { id: 'm1x1', name: "学苑广场地铁站", lng: 121.545577, lat: 38.87454, x: 167.55, y: 159.99, type: 'both', base: 'm1', stationId: 'm1', exit: 'A口', side: 'S', label: 'A口' },
  { id: 'm1x2', name: "学苑广场地铁站", lng: 121.546646, lat: 38.87555, x: 171.25, y: 155.53, type: 'both', base: 'm1', stationId: 'm1', exit: 'C口', side: 'E', label: 'C口' },
  { id: 'm2x1', name: "海事大学地铁站", lng: 121.534159, lat: 38.86621, x: 127.97, y: 196.84, type: 'both', base: 'm2', stationId: 'm2', exit: 'C口', side: 'W', label: 'C口' },
  { id: 'm2x2', name: "海事大学地铁站", lng: 121.534187, lat: 38.86664, x: 128.06, y: 194.94, type: 'both', base: 'm2', stationId: 'm2', exit: 'D口', side: 'N', label: 'D口' },
  { id: 'm3x1', name: "黑石礁地铁站", lng: 121.557138, lat: 38.87361, x: 207.62, y: 164.09, type: 'both', base: 'm3', stationId: 'm3', exit: 'A口', side: 'S', label: 'A口' },
  { id: 'm3x2', name: "黑石礁地铁站", lng: 121.55849, lat: 38.87496, x: 212.31, y: 158.14, type: 'both', base: 'm3', stationId: 'm3', exit: 'B口', side: 'E', label: 'B口' },
  { id: 'm3x3', name: "黑石礁地铁站", lng: 121.558114, lat: 38.87546, x: 211.01, y: 155.91, type: 'both', base: 'm3', stationId: 'm3', exit: 'C口', side: 'N', label: 'C口' },
  { id: 'm10x1', name: "大医二院地铁站", lng: 121.570963, lat: 38.88127, x: 255.55, y: 130.24, type: 'both', base: 'm10', stationId: 'm10', exit: 'B口', side: 'E', label: 'B口' },
  { id: 'm10x2', name: "大医二院地铁站", lng: 121.570741, lat: 38.8811, x: 254.78, y: 130.99, type: 'both', base: 'm10', stationId: 'm10', exit: 'A口', side: 'S', label: 'A口' },
  { id: 'n027x1', name: "河口地铁站", lng: 121.513274, lat: 38.84269, x: 55.57, y: 300.84, area: 'a2', type: 'both', base: 'n027', stationId: 'n027', exit: 'A口', side: 'S', label: 'A口' },
  { id: 'n027x2', name: "河口地铁站", lng: 121.513683, lat: 38.84378, x: 56.99, y: 296, area: 'a2', type: 'both', base: 'n027', stationId: 'n027', exit: 'B口', side: 'N', label: 'B口' },
  { id: 'n059x1', name: "七贤岭地铁站", lng: 121.526592, lat: 38.85681, x: 101.74, y: 238.39, area: 'a2', type: 'both', base: 'n059', stationId: 'n059', exit: 'C口', side: 'W', label: 'C口' },
  { id: 'n007x1', name: "蔡大岭地铁站", lng: 121.495086, lat: 38.85081, x: -7.48, y: 264.9, area: 'a2', type: 'both', base: 'n007', stationId: 'n007', exit: 'A口', side: 'E', label: 'A口' },
  { id: 'n007x2', name: "蔡大岭地铁站", lng: 121.49437, lat: 38.85111, x: -9.96, y: 263.6, area: 'a2', type: 'both', base: 'n007', stationId: 'n007', exit: 'B口', side: 'W', label: 'B口' },
]
