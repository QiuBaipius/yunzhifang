// 算法仿真系统 · 地图渲染（高德真实地图 · 大连）
// 静态层：运营范围边界 / 站点（地铁站重点标注）/ 车场
// 动态层：车辆实时位置 / 选中车辆的行驶路径与目标 / 订单复盘 / 全日回放
import { useEffect, useRef, useState } from 'react'
import { RINGS_LNGLAT, mapBounds, toLngLat } from '../data/geo.js'
import { loadAMap } from '../services/amapLoader.js'
import { pathPolyline } from '../core/gen.js'

const STATE_COLOR = { cruise: '#0f7a62', to_pickup: '#d4a017', onboard: '#11352c', to_depot: '#7b8794' }
const STATE_TEXT = { cruise: '候单/赶往需求点', to_pickup: '接客中', onboard: '载客运行', to_depot: '返回车场' }
const METRO = '#d92b2b'
const BLUE = '#2d6cdf'
const ORANGE = '#e07a2f'
const TEAL = '#0f7a62'
const GOLD = '#d4a017'
const LINE_COLOR = { a1: TEAL, a2: '#7c5cd6' }
const DEPOT_COLOR = { X1: LINE_COLOR.a1, X2: LINE_COLOR.a2 }

export default function SimMap({
  map,
  vehicles,
  selectedId,
  onSelectVehicle,
  callFromId,
  callToId,
  focus,
  replay,
  // 每次仿真推进时变化的帧号（引擎里的车辆数组是原地变更的，
  // 只靠 vehicles 的引用变化不会触发更新，必须显式给一个帧依赖）
  frame = 0,
  height = 460,
}) {
  const hostRef = useRef(null)
  const amapRef = useRef(null)
  const markersRef = useRef(new Map())
  const staticRef = useRef([])
  const dynRef = useRef([])
  const routeRef = useRef(null)
  const targetRef = useRef(null)
  const replayRef = useRef({})
  const lastSelRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState(14)

  // ---- 初始化底图与静态图层（地图换了才重建）----
  useEffect(() => {
    let alive = true
    loadAMap()
      .then((AMap) => {
        if (!alive || !hostRef.current) return
        const b = mapBounds()
        const m = new AMap.Map(hostRef.current, {
          zoom: 14,
          center: [(b.southWest[0] + b.northEast[0]) / 2, (b.southWest[1] + b.northEast[1]) / 2],
          viewMode: '2D',
          resizeEnable: true,
          mapStyle: 'amap://styles/normal',
        })
        m.addControl(new AMap.Scale({ position: 'LB' }))
        m.on('zoomend', () => setZoom(m.getZoom()))
        amapRef.current = m
        // 开发期留一个地图句柄，便于在控制台核对图层（生产构建不会注入）
        if (import.meta.env.DEV) window.__simMap = m

        const layer = []
        // 运营范围：按线路逐环绘制（X1 青绿 / X2 紫罗兰，与乘客端一致）
        for (const [areaId, rings] of Object.entries(RINGS_LNGLAT)) {
          const color = LINE_COLOR[areaId] || TEAL
          for (const ring of rings) {
            layer.push(
              new AMap.Polygon({
                path: ring,
                strokeColor: color,
                strokeWeight: 2.5,
                strokeStyle: 'dashed',
                fillColor: color,
                fillOpacity: areaId === 'a2' ? 0.035 : 0.05,
                zIndex: 10,
              }),
            )
          }
        }

        // 站点：小圆点，地铁仅用红色区分，不再逐站标名字
        for (const s of map.stops) {
          const isMetro = !!s.metro
          const color = isMetro ? METRO : BLUE
          if (isMetro) {
            layer.push(
              new AMap.CircleMarker({
                center: toLngLat(s),
                radius: 7,
                strokeWeight: 0,
                fillColor: METRO,
                fillOpacity: 0.14,
                zIndex: 30,
              }),
            )
          }
          layer.push(
            new AMap.CircleMarker({
              center: toLngLat(s),
              radius: isMetro ? 3.5 : 2.5,
              strokeColor: '#fff',
              strokeWeight: isMetro ? 1.5 : 1,
              fillColor: color,
              fillOpacity: 1,
              zIndex: isMetro ? 42 : 32,
            }),
          )
        }

        // 车场：每条线路只保留一个标注（X1 车场 / X2 车场），颜色与线路一致
        for (const d of map.depots || (map.depot ? [map.depot] : [])) {
          const c = DEPOT_COLOR[d.lineId] || '#334155'
          layer.push(
            new AMap.Text({
              text: `${d.lineId || ''} 车场`,
              position: toLngLat(d),
              anchor: 'center',
              zIndex: 46,
              style: {
                'font-size': '11px',
                'font-weight': '700',
                color: '#fff',
                'background-color': c,
                border: 'none',
                padding: '2px 6px',
                'border-radius': '4px',
                'white-space': 'nowrap',
              },
            }),
          )
        }

        m.add(layer)
        staticRef.current = layer
        m.setBounds(new AMap.Bounds(b.southWest, b.northEast), false)
        setReady(true)
      })
      .catch((e) => alive && setErr(e.message))
    return () => {
      alive = false
      if (amapRef.current) {
        amapRef.current.destroy()
        amapRef.current = null
      }
      // 卸载时地图实例已销毁，图层引用随之失效，无需逐个清理
    }
  }, [map])

  // ---- 车辆实时位置 + 选中车辆的路径/目标（只更新坐标与路径，不重建）----
  useEffect(() => {
    if (!ready || !amapRef.current) return
    const AMap = window.AMap
    const m = amapRef.current
    const seen = new Set()
    for (const v of vehicles) {
      seen.add(v.id)
      let mk = markersRef.current.get(v.id)
      const color = STATE_COLOR[v.state] || TEAL
      const isSel = v.id === selectedId
      // 未选中：只画一个小圆点（默认大小，不遮挡路网）；选中：圆点外圈 + 车牌标签
      const html = isSel
        ? `<div style="transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;position:relative;">
            <div style="position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border:2px solid #d4a017;border-radius:50%;"></div>
            <div style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:8px;border:1.5px solid #fff;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25)">${v.plate}${v.onboard ? ` · ${v.onboard}人` : ''}</div>
          </div>`
        : `<div style="transform:translate(-50%,-50%);width:9px;height:9px;border-radius:50%;background:${color};border:1.5px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.3);"></div>`
      if (!mk) {
        mk = new AMap.Marker({
          position: toLngLat(v),
          anchor: 'center',
          zIndex: isSel ? 300 : 200,
          content: html,
        })
        mk.on('click', () => onSelectVehicle?.(v.id === selectedId ? null : v.id))
        m.add(mk)
        markersRef.current.set(v.id, mk)
        mk.__html = html
      } else {
        // 每帧只更新坐标；HTML 变了（状态色 / 在车人数 / 选中态）才重建内容
        mk.setPosition(toLngLat(v))
        if (mk.__html !== html) {
          mk.setContent(html)
          mk.__html = html
        }
        mk.setzIndex(isSel ? 300 : 200)
      }
    }
    for (const [id, mk] of [...markersRef.current]) {
      if (!seen.has(id)) {
        m.remove(mk)
        markersRef.current.delete(id)
      }
    }

    // 选中车辆：实时绘制「目标行驶线路」
    const sel = vehicles.find((v) => v.id === selectedId)
    const pts =
      sel && sel.path && sel.path.length > 1
        ? pathPolyline(map, sel.path).map(([x, y]) => toLngLat({ x, y }))
        : []
    if (pts.length > 1) {
      if (!routeRef.current) {
        routeRef.current = new AMap.Polyline({
          path: pts,
          strokeColor: GOLD,
          strokeWeight: 5,
          strokeStyle: 'solid',
          strokeOpacity: 0.95,
          zIndex: 250,
          showDir: true,
        })
        m.add(routeRef.current)
      }
      routeRef.current.setPath(pts)
      routeRef.current.show()
      if (import.meta.env.DEV) window.__simRoute = routeRef.current
    } else if (routeRef.current) {
      routeRef.current.hide()
    }

    // 单车视角：首次选中把视野拉到车附近；之后车驶出视野中心约 300m 再跟过去（复盘时不跟车）
    if (sel && lastSelRef.current !== sel.id) {
      lastSelRef.current = sel.id
      if (m.setZoomAndCenter) m.setZoomAndCenter(Math.max(m.getZoom(), 15), toLngLat(sel))
      else {
        m.setZoom(Math.max(m.getZoom(), 15))
        m.setCenter(toLngLat(sel))
      }
    } else if (sel && !focus?.orderId) {
      const c = m.getCenter()
      const p = toLngLat(sel)
      if (Math.abs(p[0] - c.lng) > 0.0035 || Math.abs(p[1] - c.lat) > 0.0028) m.setCenter(p)
    } else if (!sel) {
      lastSelRef.current = null
    }

    if (sel?.target) {
      const html = `<div style="transform:translate(-50%,-100%);background:#d4a017;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px;white-space:nowrap;border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25)">目标 ${sel.target.name}</div>`
      if (!targetRef.current) {
        targetRef.current = new AMap.Marker({
          position: toLngLat(sel.target),
          anchor: 'center',
          zIndex: 260,
          content: html,
        })
        m.add(targetRef.current)
      } else {
        targetRef.current.setPosition(toLngLat(sel.target))
        targetRef.current.setContent(html)
        targetRef.current.show()
      }
    } else if (targetRef.current) {
      targetRef.current.hide()
    }
  }, [ready, vehicles, selectedId, onSelectVehicle, map, focus, frame])

  // ---- 呼叫 OD / 订单复盘（依赖选中与复盘对象）----
  useEffect(() => {
    if (!ready || !amapRef.current) return
    const AMap = window.AMap
    const m = amapRef.current
    if (dynRef.current.length) m.remove(dynRef.current)
    const layer = []

    // 呼叫中的 OD
    if (callFromId && callToId) {
      const a = map.stopById.get(callFromId)
      const b = map.stopById.get(callToId)
      if (a && b) {
        layer.push(
          new AMap.Polyline({
            path: [toLngLat(a), toLngLat(b)],
            strokeColor: BLUE,
            strokeWeight: 3,
            strokeOpacity: 0.7,
            zIndex: 140,
          }),
        )
      }
    }

    // 订单复盘图层
    const ev = focus?.evidence
    if (ev) {
      const P = (p) => toLngLat(p)
      if (ev.detour?.firstFrom && ev.detour?.firstTo) {
        layer.push(
          new AMap.Polyline({
            path: [P(ev.detour.firstFrom), P(ev.detour.firstTo)],
            strokeColor: BLUE,
            strokeWeight: 3,
            strokeStyle: 'dashed',
            strokeOpacity: 0.85,
            zIndex: 160,
          }),
        )
      }
      if (ev.beforePath?.length > 1) {
        layer.push(
          new AMap.Polyline({
            path: ev.beforePath.map(P),
            strokeColor: '#7b8794',
            strokeWeight: 5,
            strokeStyle: 'dashed',
            strokeOpacity: 0.9,
            zIndex: 155,
          }),
        )
      }
      if (ev.afterPath?.length > 1) {
        layer.push(
          new AMap.Polyline({
            path: ev.afterPath.map(P),
            strokeColor: ORANGE,
            strokeWeight: 4,
            strokeStyle: 'dashed',
            strokeOpacity: 0.95,
            zIndex: 158,
          }),
        )
      }
      const label = (text, pos, color, offsetY = 10) =>
        new AMap.Text({
          text,
          position: P(pos),
          anchor: 'top-center',
          offset: new AMap.Pixel(0, offsetY),
          zIndex: 180,
          style: {
            'font-size': '12px',
            'font-weight': '700',
            color: '#fff',
            'background-color': color,
            border: 'none',
            padding: '2px 7px',
            'border-radius': '4px',
            'white-space': 'nowrap',
            'box-shadow': '0 1px 4px rgba(15,23,42,.3)',
          },
        })

      if (ev.beforeTarget) {
        layer.push(
          new AMap.CircleMarker({
            center: P(ev.beforeTarget),
            radius: 6,
            strokeColor: '#7b8794',
            strokeWeight: 2,
            fillColor: '#fff',
            fillOpacity: 1,
            zIndex: 170,
          }),
          label(`原定 ${ev.beforeTarget.name}`, ev.beforeTarget, '#5b6773'),
        )
      }
      if (ev.beforePos) {
        layer.push(
          new AMap.CircleMarker({
            center: P(ev.beforePos),
            radius: 5,
            strokeColor: '#fff',
            strokeWeight: 2,
            fillColor: '#7b8794',
            fillOpacity: 1,
            zIndex: 170,
          }),
        )
      }
      if (ev.destPos) {
        layer.push(
          new AMap.Marker({
            position: P(ev.destPos),
            anchor: 'center',
            zIndex: 175,
            content:
              '<div style="width:12px;height:12px;background:#c44a3b;border:2px solid #fff;transform:translate(-50%,-50%);border-radius:2px;"></div>',
          }),
          label(`目的地 ${ev.destPos.name}`, ev.destPos, '#a33a2c', 10),
        )
      }
      if (ev.pickupPos) {
        layer.push(
          new AMap.CircleMarker({
            center: P(ev.pickupPos),
            radius: 10,
            strokeWeight: 0,
            fillColor: ORANGE,
            fillOpacity: 0.2,
            zIndex: 172,
          }),
          new AMap.CircleMarker({
            center: P(ev.pickupPos),
            radius: 7,
            strokeColor: '#fff',
            strokeWeight: 2,
            fillColor: ORANGE,
            fillOpacity: 1,
            zIndex: 176,
          }),
          label(`新呼叫 ${ev.pickupPos.name}`, ev.pickupPos, '#b45309', 12),
        )
      }
      if (ev.detour?.firstOdKm) {
        const mid = {
          x: (ev.detour.firstFrom.x + ev.detour.firstTo.x) / 2,
          y: (ev.detour.firstFrom.y + ev.detour.firstTo.y) / 2,
        }
        layer.push(
          new AMap.Text({
            text: `OD 最优路径 ${ev.detour.firstOdKm.toFixed(2)}km`,
            position: P(mid),
            anchor: 'bottom-center',
            offset: new AMap.Pixel(0, -6),
            zIndex: 178,
            style: {
              'font-size': '11px',
              color: '#1d4ed8',
              'background-color': 'rgba(255,255,255,.92)',
              border: '1px solid #c7d6f5',
              padding: '1px 5px',
              'border-radius': '4px',
              'white-space': 'nowrap',
            },
          }),
        )
      }
      // 视野收到这一单现场
      const pts = [...(ev.beforePath || []), ...(ev.afterPath || []), ev.beforePos, ev.pickupPos, ev.destPos].filter(Boolean)
      if (pts.length > 1) {
        const lngs = pts.map(P)
        let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
        for (const [lng, lat] of lngs) {
          minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng)
          minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
        }
        m.setBounds(new AMap.Bounds([minLng, minLat], [maxLng, maxLat]), false, [60, 60, 60, 60])
      }
    }

    if (layer.length) m.add(layer)
    dynRef.current = layer
  }, [ready, focus, callFromId, callToId, map])

  // ---- 全日回放图层（轨迹 + 当前订单）----
  const replayKey = replay ? Math.round(replay.t) : null
  const replayOrderKey = replay?.order?.orderId || null
  useEffect(() => {
    if (!ready || !amapRef.current) return
    const AMap = window.AMap
    const m = amapRef.current
    const rr = replayRef.current
    const destroy = () => {
      const overlays = [rr.marker, rr.trail, rr.od, rr.fromMk, rr.toMk, rr.text].filter(Boolean)
      if (overlays.length) m.remove(overlays)
      replayRef.current = {}
    }
    if (!replay || !replay.pos) {
      destroy()
      return
    }
    const P = (p) => toLngLat(p)
    if (!rr.marker || rr.id !== replay.id) {
      destroy()
      const marker = new AMap.Marker({
        position: P(replay.pos),
        anchor: 'center',
        zIndex: 320,
        content: `<div style="background:#11352c;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:9px;border:2px solid #fff;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">${replay.plate}</div>`,
      })
      const trail = new AMap.Polyline({
        path: [],
        strokeColor: GOLD,
        strokeWeight: 4,
        strokeOpacity: 0.55,
        zIndex: 240,
        showDir: true,
      })
      m.add([marker, trail])
      replayRef.current = { id: replay.id, marker, trail }
      if (import.meta.env.DEV) window.__simReplay = replayRef.current
      // 视野收到这辆车当天的活动范围
      if (replay.bounds) {
        m.setBounds(new AMap.Bounds(replay.bounds[0], replay.bounds[1]), false, [70, 70, 70, 70])
      }
    } else {
      rr.marker.setPosition(P(replay.pos))
      rr.marker.setContent(
        `<div style="background:#11352c;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:9px;border:2px solid #fff;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">${replay.plate}${replay.pos.n ? ` · ${replay.pos.n}人` : ''}</div>`,
      )
    }
    const rr2 = replayRef.current
    if (replay.trail && replay.trail.length > 1) {
      rr2.trail.setPath(replay.trail.map(P))
      rr2.trail.show()
    } else {
      rr2.trail.hide()
    }

    // 当前订单的 OD
    const ord = replay.order
    if (ord && (rr2.orderKey !== ord.orderId)) {
      if (rr2.od) m.remove([rr2.od, rr2.fromMk, rr2.toMk, rr2.text].filter(Boolean))
      const from = map.stopById.get(ord.fromId)
      const to = map.stopById.get(ord.toId)
      if (from && to) {
        rr2.od = new AMap.Polyline({
          path: [P(from), P(to)],
          strokeColor: BLUE,
          strokeWeight: 4,
          strokeStyle: 'dashed',
          strokeOpacity: 0.85,
          zIndex: 250,
        })
        rr2.fromMk = new AMap.CircleMarker({
          center: P(from),
          radius: 8,
          strokeColor: '#fff',
          strokeWeight: 2,
          fillColor: ORANGE,
          fillOpacity: 1,
          zIndex: 255,
        })
        rr2.toMk = new AMap.CircleMarker({
          center: P(to),
          radius: 8,
          strokeColor: '#fff',
          strokeWeight: 2,
          fillColor: '#c44a3b',
          fillOpacity: 1,
          zIndex: 255,
        })
        rr2.text = new AMap.Text({
          text: `${ord.orderId}  ${ord.fromName} → ${ord.toName}`,
          position: P(from),
          anchor: 'top-center',
          offset: new AMap.Pixel(0, 12),
          zIndex: 258,
          style: {
            'font-size': '11px',
            'font-weight': '700',
            color: '#fff',
            'background-color': '#2d6cdf',
            border: 'none',
            padding: '2px 7px',
            'border-radius': '4px',
            'white-space': 'nowrap',
          },
        })
        m.add([rr2.od, rr2.fromMk, rr2.toMk, rr2.text])
      }
      rr2.orderKey = ord.orderId
    } else if (!ord && rr2.orderKey) {
      if (rr2.od) m.remove([rr2.od, rr2.fromMk, rr2.toMk, rr2.text].filter(Boolean))
      rr2.od = null
      rr2.fromMk = null
      rr2.toMk = null
      rr2.text = null
      rr2.orderKey = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, replay?.id, replayKey, replayOrderKey, map])

  const zoomBy = (f) => {
    const m = amapRef.current
    if (!m) return
    m.setZoom(Math.max(11, Math.min(18, m.getZoom() + (f > 1 ? 1 : -1))))
  }

  const showReplayLegend = !!replay
  const showFocusLegend = !!focus?.evidence

  return (
    <div className="sim-map" style={{ height }}>
      <div ref={hostRef} className="sim-amap-host" />
      {!ready && !err && <div className="sim-map-loading">正在加载大连真实地图…</div>}
      {err && <div className="sim-map-loading">地图加载失败：{err}</div>}

      <div className="sim-map-zoom">
        <button onClick={() => zoomBy(1.25)} aria-label="放大">＋</button>
        <button onClick={() => zoomBy(0.8)} aria-label="缩小">－</button>
        <button
          onClick={() => {
            const b = mapBounds()
            amapRef.current?.setBounds(new window.AMap.Bounds(b.southWest, b.northEast), false)
          }}
          aria-label="复位"
        >
          ⌂
        </button>
      </div>
      <div className="sim-map-legend">
        <div><span className="dot metro" />地铁站</div>
        <div><span className="dot blue" />公交站</div>
        <div><span className="depot" style={{ background: DEPOT_COLOR.X1 }} />X1 车场</div>
        <div><span className="depot" style={{ background: DEPOT_COLOR.X2 }} />X2 车场</div>
        <div><span className="dash" style={{ borderTopColor: LINE_COLOR.a1 }} />X1 运营范围</div>
        <div><span className="dash" style={{ borderTopColor: LINE_COLOR.a2 }} />X2 运营范围</div>
        {showReplayLegend ? (
          <>
            <div><span className="dash" style={{ borderTopColor: GOLD }} />当日行驶轨迹</div>
            <div><span className="dash" style={{ borderTopColor: BLUE }} />当前订单 OD</div>
          </>
        ) : showFocusLegend ? (
          <>
            <div><span className="dash" style={{ borderTopColor: '#7b8794' }} />车辆原路线</div>
            <div><span className="dash" style={{ borderTopColor: ORANGE }} />插入新客后的路线</div>
            <div><span className="dash" style={{ borderTopColor: BLUE }} />该乘客 OD 最优路径</div>
          </>
        ) : vehicles.length === 0 ? null : (
          <>
            <div><span className="dot teal" />候单 / 赶往需求点</div>
            <div><span className="dot gold" />接客中</div>
            <div><span className="dot dark" />载客运行</div>
            {selectedId && <div><span className="dash" style={{ borderTopColor: GOLD }} />本车目标行驶线路</div>}
          </>
        )}
      </div>
      {replay && <div className="sim-map-replaytag">回放 {STATE_TEXT[replay.pos?.st] || '行驶中'}</div>}
      <div className="sim-map-zoomlevel">z{zoom}</div>
    </div>
  )
}
