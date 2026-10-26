import type { Register } from 'claude-code'

const TOOL = 'mcp__animate__animate'
type Scene = 'aurora' | 'plasma' | 'sunset' | 'warp' | 'breathe' | 'fireworks' | 'rain'
const SCENE_IDS: Scene[] = ['aurora', 'plasma', 'sunset', 'warp', 'breathe', 'fireworks', 'rain']

type RGB = [number, number, number]


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

// Fireworks: bursts that expand and fade, seeded per cycle
const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}
const fireworks = (x: number, y: number, t: number, aspect: number): RGB => {
  let col: RGB = mix([2, 2, 12], [10, 6, 30], y)
  for (let k = 0; k < 4; k++) {
    const cycle = Math.floor(t / 2.2 + k * 0.37)
    const age = (t / 2.2 + k * 0.37) - cycle
    const seed = cycle * 7 + k
    const cx = 0.15 + 0.7 * hash(seed)
    const cy = 0.2 + 0.4 * hash(seed + 1)
    const hue = ramp([[255, 80, 80], [255, 200, 60], [80, 255, 160], [90, 160, 255], [230, 90, 255]], hash(seed + 2))
    const dx = (x - cx) * aspect
    const dy = y - cy
    const r = Math.hypot(dx, dy)
    const ang = Math.atan2(dy, dx)
    const radius = age * 0.35
    const spokes = Math.pow(Math.max(0, Math.cos(ang * 9 + seed)), 6)
    const ring = Math.exp(-((r - radius) ** 2) * 900) * spokes
    const fade = (1 - age) * (1 - age)
    col = mix(col, hue, Math.min(1, ring * fade * 2.5))
  }
  return col
}

// Rain: Matrix-style falling streams
const rain = (x: number, y: number, t: number, cols: number): RGB => {
  const lane = Math.floor(x * cols)
  const speed = 0.4 + hash(lane) * 0.8
  const head = (t * speed + hash(lane + 99)) % 1.4
  const d = head - y
  const glow = d >= 0 && d < 0.5 ? (1 - d / 0.5) ** 2 : 0
  const isHead = d >= 0 && d < 0.03
  return isHead ? [200, 255, 210] : mix([0, 6, 2], [30, 255, 90], glow)
}

const render = (cols: number, rows: number, shade: (x: number, y: number) => RGB, caption?: string): string => {
  const words = new Uint32Array(cols * rows * 3)
  const ph = rows * 2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3
      words[i] = 0x2580
      words[i + 1] = pack(shade(c / cols, (r * 2) / ph))
      words[i + 2] = pack(shade(c / cols, (r * 2 + 1) / ph))
    }
  }
  if (caption) {
    const text = caption.replace(/[^\x20-\x7e]/g, '').slice(0, cols)
    const start = Math.max(0, Math.floor((cols - text.length) / 2))
    const row = rows - 1
    for (let k = 0; k < text.length; k++) {
      const i = (row * cols + start + k) * 3
      words[i] = text.charCodeAt(k)
      words[i + 1] = 0xffffff
    }
  }
  return (new Uint8Array(words.buffer) as unknown as { toBase64: () => string }).toBase64()
}

type Spec = { scene: Scene; seconds: number; caption: string; rows: number }
type Live = Spec & { cols: number; startedAt: number }

const parseSpec = (out: unknown): Spec | null => {
  const text = typeof out === 'string' ? out
    : Array.isArray(out) ? out.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
    : ''
  try {
    const s = JSON.parse(text) as Spec
    return SCENE_IDS.includes(s.scene) ? s : null
  } catch {
    return null
  }
}

export const register: Register = on => {
  // Rows currently playing, by tool_use_id (the row's site for $.ui.blit)
  const live = new Map<string, Live>()

  const frame = (l: Live, now: number) => {
    const t = (now - l.startedAt) / 1000
    const aspect = l.cols / (l.rows * 2)
    const pal = palette()
    let caption = l.caption
    if (l.scene === 'breathe') {
      const b = breathPhase(t)
      caption = `${b.label}  ${Math.ceil(b.left)}`
    }
    const shade = (x: number, y: number): RGB =>
      l.scene === 'aurora' ? aurora(x, y, t, pal, 1)
      : l.scene === 'plasma' ? plasma(x, y, t)
      : l.scene === 'sunset' ? sunset(x, y, t)
      : l.scene === 'warp' ? warp(x, y, t)
      : l.scene === 'breathe' ? breathe(x, y, t, aspect)
      : l.scene === 'fireworks' ? fireworks(x, y, t, aspect)
      : rain(x, y, t, l.cols)
    return render(l.cols, l.rows, shade, caption)
  }

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'animate',
      description:
        'Play a short truecolor animation inline in the chat, in this tool\'s own row. Use when the user asks for an animation, ' +
        'a celebration (fireworks), a calm moment (breathe: a 4-4-6 breathing lotus), or ambient visuals. ' +
        'scene: aurora | plasma | sunset | warp | breathe | fireworks | rain. seconds: 3 to 120 (default 20). caption: optional short text.',
      inputSchema: {
        type: 'object',
        properties: {
          scene: { type: 'string', enum: SCENE_IDS },
          seconds: { type: 'number' },
          caption: { type: 'string' },
          rows: { type: 'number', description: 'height in terminal rows, 4 to 20, default 10' },
        },
        required: ['scene'],
      },
    })

    // ~15 fps: repaint only the pixels of live rows; drop finished ones
    $.clock.every(66, () => {
      const now = Date.now()
      for (const [id, l] of live) {
        if (now - l.startedAt > l.seconds * 1000) {
          live.delete(id)
          continue
        }
        void $.ui.blit({ requestId: id, key: 'anim', cells: frame(l, now) }).then(r => {
          if (r && 'deny' in r && r.deny) live.delete(id)
        }).catch(() => live.delete(id))
      }
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Partial<Spec>
    const scene = SCENE_IDS.includes(input.scene as Scene) ? (input.scene as Scene) : 'aurora'
    const spec: Spec = {
      scene,
      seconds: Math.max(3, Math.min(120, Number(input.seconds) || 20)),
      caption: String(input.caption ?? ''),
      rows: Math.max(4, Math.min(20, Number(input.rows) || 10)),
    }
    return { result: JSON.stringify({ ...spec, note: `Playing ${scene} for ${spec.seconds}s in the chat.` }) }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== TOOL || e.props.isErrored || e.surface !== 'terminal') return next(e)
    const spec = parseSpec(e.props.output)
    if (!spec) return next(e)
    const { Raster } = $.ui.resolve(e)
    const id = e.props.tool_use_id
    const cols = Math.max(20, Math.min(512, (e.viewport?.columns ?? 100) - 6))
    const existing = live.get(id)
    const l: Live = existing && existing.cols === cols ? existing
      : { ...spec, cols, startedAt: existing?.startedAt ?? Date.now() }
    // Only (re)start rows that are still within their play time
    if (!existing && Date.now() - l.startedAt < spec.seconds * 1000) live.set(id, l)
    if (existing && existing.cols !== cols) live.set(id, l)
    return <Raster key="anim" columns={cols} rows={spec.rows} cells={frame(l, Date.now())} />
  })
}
