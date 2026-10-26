import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Scene } from '../types'

const PANE = 'aurora-visuals'
const scene = atom({ plugin: 'aurora', key: 'scene' } as const, 'aurora')
const isBandOn = atom({ plugin: 'aurora', key: 'isBandOn' } as const, true)

type RGB = [number, number, number]

const SCENES: { id: Scene; label: string }[] = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'plasma', label: 'Plasma' },
  { id: 'sunset', label: 'Ocean sunset' },
  { id: 'warp', label: 'Warp' },
  { id: 'breathe', label: 'Breathe' },
]

// ---------- colour helpers ----------
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
const pack = (c: RGB) => (clamp(c[0]) << 16) | (clamp(c[1]) << 8) | clamp(c[2])
const ramp = (stops: RGB[], k: number): RGB => {
  const t = Math.max(0, Math.min(0.9999, k)) * (stops.length - 1)
  const i = Math.floor(t)
  return mix(stops[i]!, stops[i + 1]!, t - i)
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// Palettes follow the clock: night, dawn, day, dusk
const palette = (): RGB[] => {
  const h = new Date().getHours()
  if (h >= 5 && h < 8) return [[255, 120, 150], [255, 180, 120], [180, 120, 255]]
  if (h >= 8 && h < 17) return [[60, 200, 255], [120, 255, 200], [90, 140, 255]]
  if (h >= 17 && h < 20) return [[255, 110, 60], [255, 60, 140], [140, 70, 255]]
  return [[40, 255, 170], [60, 180, 255], [190, 90, 255]]
}

// ---------- shaders: (x, y in 0..1, t seconds) -> colour ----------
const aurora = (x: number, y: number, t: number, pal: RGB[], energy: number): RGB => {
  const sky: RGB = mix([4, 6, 20], [10, 14, 40], y)
  let col = sky
  for (let band = 0; band < 3; band++) {
    const center = 0.5 + 0.28 * Math.sin(x * (3 + band) + t * (0.25 + band * 0.1) * energy + band * 2)
      + 0.08 * Math.sin(x * 11 - t * 0.7 * energy + band)
    const d = Math.abs(y - center)
    const glow = Math.exp(-d * d * 60) * (0.55 + 0.45 * Math.sin(x * 20 + t * 1.5 * energy + band * 1.7))
    col = mix(col, pal[band % pal.length]!, Math.min(1, glow * (0.5 + 0.5 * energy)))
  }
  return col
}

const plasma = (x: number, y: number, t: number): RGB => {
  const v = Math.sin(x * 10 + t) + Math.sin((y * 10 + t) / 2) + Math.sin((x * 10 + y * 10 + t) / 2)
    + Math.sin(Math.sqrt((x - 0.5) ** 2 * 100 + (y - 0.5) ** 2 * 100) + t)
  const k = (v + 4) / 8
  return ramp([[20, 0, 60], [255, 40, 120], [255, 180, 60], [40, 220, 255], [20, 0, 60]], (k + t * 0.05) % 1)
}

const sunset = (x: number, y: number, t: number): RGB => {
  const horizon = 0.55
  if (y < horizon) {
    const sky = ramp([[30, 10, 70], [190, 50, 120], [255, 140, 70], [255, 210, 130]], y / horizon)
    const sun = Math.hypot((x - 0.5) * 1.6, y - horizon + 0.08)
    const disc = smooth(0.17, 0.15, sun)
    const stripes = y > horizon - 0.12 && Math.sin(y * 120) > 0.4 ? 0 : 1
    return mix(sky, [255, 230, 150], disc * stripes)
  }
  const depth = (y - horizon) / (1 - horizon)
  const wave = Math.sin(x * 40 + t * 2 + depth * 30) * Math.sin(x * 13 - t + depth * 10)
  const water = ramp([[120, 40, 110], [40, 20, 80], [10, 10, 40]], depth)
  const glitter = Math.abs(x - 0.5) < 0.12 * (1 - depth * 0.5) && wave > 0.5 ? 0.7 : 0
  return mix(water, [255, 200, 120], glitter)
}

const warp = (x: number, y: number, t: number): RGB => {
  const dx = x - 0.5
  const dy = (y - 0.5) * 0.6
  const ang = Math.atan2(dy, dx)
  const r = Math.hypot(dx, dy)
  const lane = Math.floor((ang + Math.PI) * 18)
  const seed = Math.sin(lane * 91.7) * 43758.5
  const speed = 0.5 + (seed - Math.floor(seed))
  const pos = (t * speed * 0.6 + (seed - Math.floor(seed))) % 1
  const streak = Math.exp(-Math.abs(r - pos * 0.8) * 40) * smooth(0.02, 0.15, r)
  const hue = ramp([[120, 160, 255], [255, 255, 255], [255, 120, 220]], (seed * 7) % 1 < 0 ? 0 : ((seed * 7) % 1))
  return mix([2, 2, 10], hue, Math.min(1, streak * 1.5))
}

// Breathing lotus: in 4s, hold 4s, out 6s
const BREATH = 14
const breathPhase = (t: number) => {
  const c = t % BREATH
  if (c < 4) return { label: 'breathe in', left: 4 - c, k: smooth(0, 1, c / 4) }
  if (c < 8) return { label: 'hold', left: 8 - c, k: 1 }
  return { label: 'breathe out', left: BREATH - c, k: 1 - smooth(0, 1, (c - 8) / 6) }
}
const breathe = (x: number, y: number, t: number, aspect: number): RGB => {
  const { k } = breathPhase(t)
  const dx = (x - 0.5) * aspect
  const dy = y - 0.5
  const r = Math.hypot(dx, dy)
  const ang = Math.atan2(dy, dx)
  const size = 0.12 + 0.22 * k
  const petals = size * (0.75 + 0.25 * Math.abs(Math.cos(ang * 4 + t * 0.2)))
  const inner = size * 0.45 * (0.8 + 0.2 * Math.cos(ang * 8 - t * 0.3))
  const bg: RGB = mix([6, 10, 24], [18, 12, 40], y)
  const halo = Math.exp(-((r - petals) ** 2) * 300) * 0.6
  let col = mix(bg, [120, 90, 255], halo)
  if (r < petals) col = mix([255, 120, 190], [255, 200, 230], 1 - r / petals)
  if (r < inner) col = mix([255, 220, 120], [255, 250, 220], 1 - r / inner)
  return col
}

// ---------- rasterise: two pixels per cell via the upper half block ----------
const render = (
  cols: number,
  rows: number,
  shade: (x: number, y: number) => RGB,
  overlay?: { text: string; row: number },
): string => {
  const words = new Uint32Array(cols * rows * 3)
  const ph = rows * 2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const top = shade(c / cols, (r * 2) / ph)
      const bottom = shade(c / cols, (r * 2 + 1) / ph)
      const i = (r * cols + c) * 3
      words[i] = 0x2580
      words[i + 1] = pack(top)
      words[i + 2] = pack(bottom)
    }
  }
  if (overlay) {
    const start = Math.max(0, Math.floor((cols - overlay.text.length) / 2))
    for (let k = 0; k < overlay.text.length && start + k < cols; k++) {
      const i = (overlay.row * cols + start + k) * 3
      const behind = words[i + 2]!
      words[i] = overlay.text.charCodeAt(k)
      words[i + 1] = 0xffffff
      words[i + 2] = behind
    }
  }
  return (new Uint8Array(words.buffer) as unknown as { toBase64: () => string }).toBase64()
}

export const register: Register = on => {
  // What is currently mounted, so the clock can repaint pixels with $.ui.blit
  // instead of redrawing the tree (redraws rebuilt the buttons and ate clicks).
  let band: { id: string; cols: number; working: boolean } | null = null
  let pane: { cols: number; rows: number; scene: Scene } | null = null

  const shadeFor = (s: Scene, t: number, aspect: number, pal: RGB[]) => (x: number, y: number): RGB =>
    s === 'aurora' ? aurora(x, y, t, pal, 1)
    : s === 'plasma' ? plasma(x, y, t)
    : s === 'sunset' ? sunset(x, y, t)
    : s === 'warp' ? warp(x, y, t)
    : breathe(x, y, t, aspect)
  const overlayFor = (s: Scene, t: number, rows: number) => {
    if (s !== 'breathe') return undefined
    const b = breathPhase(t)
    return { text: ` ${b.label}  ${Math.ceil(b.left)} `, row: rows - 2 }
  }
  const bandCells = (cols: number, working: boolean) => {
    const t = Date.now() / 1000
    const pal = palette()
    return render(cols, 2, (x, y) => scale(aurora(x, y, t, pal, working ? 1.8 : 0.6), working ? 1 : 0.75))
  }
  const paneCells = (p: { cols: number; rows: number; scene: Scene }) => {
    const t = Date.now() / 1000
    return render(p.cols, p.rows, shadeFor(p.scene, t, p.cols / (p.rows * 2), palette()), overlayFor(p.scene, t, p.rows))
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'visuals', description: 'Open the generative visuals gallery' })
    await $.command.register({ name: 'aurora', description: 'Toggle the aurora band above the prompt' })
    // Drive the animation: redraw this plugin's band and pane about 12 times a second
    $.clock.every(80, () => {
      if (band) void $.ui.blit({ requestId: band.id, key: 'aurora-band', cells: bandCells(band.cols, band.working) }).catch(() => {})
      if (pane) void $.ui.blit({ requestId: PANE, key: 'gallery', cells: paneCells(pane) }).catch(() => {})
    })
    return next(e)
  })

  on('command.run', { command: 'visuals' }, async ($, e) => {
    const want = e.args.trim().toLowerCase()
    const hit = SCENES.find(sc => sc.id === want || sc.label.toLowerCase() === want)
    if (hit) await update($, scene, () => hit.id)
    await $.ui.open({ id: PANE, title: 'Visuals', focus: true })
    return { text: `Visuals gallery opened${hit ? ` on ${hit.label}` : ''}. Press 1-5, or Tab/arrows + Enter, to switch; Esc returns to the prompt.` }
  })

  on('command.run', { command: 'aurora' }, async $ => {
    const on_ = !(await read($, isBandOn))
    await update($, isBandOn, () => on_)
    return { text: on_ ? 'Aurora band on.' : 'Aurora band off.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isBandOn))) {
      band = null
      return next(e)
    }
    if (e.surface !== 'terminal') return next(e)
    const { Raster } = $.ui.resolve(e)
    const cols = Math.max(10, Math.min(512, e.props.bodyColumns))
    band = { id: e.requestId ?? 'band', cols, working: e.props.isWorking }
    return <Raster key="aurora-band" columns={cols} rows={2} cells={bandCells(cols, e.props.isWorking)} />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : null
    const s = await read($, scene)
    const cols = Math.max(20, Math.min(512, (e.viewport?.columns ?? 60) - 2))
    const rows = Math.max(6, Math.min(256, (e.viewport?.rows ?? 24) - 6))
    pane = { cols, rows, scene: s }

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          {SCENES.map((sc, i) => (
            <Button key={`sc-${sc.id}`} label={s === sc.id ? `▸${sc.label}` : sc.label}
              hotkey={String(i + 1)} autoFocus={s === sc.id}
              variant={s === sc.id ? 'primary' : undefined}
              onPress={() => void update($, scene, () => sc.id)} />
          ))}
        </Box>
        {Raster
          ? <Raster key="gallery" columns={cols} rows={rows} cells={paneCells({ cols, rows, scene: s })} />
          : <Text dimColor>This surface cannot draw pixels.</Text>}
        {s === 'breathe' && <Text dimColor>4 in, 4 hold, 6 out. Three rounds before an interview.</Text>}
      </Box>
    )
  })
}
