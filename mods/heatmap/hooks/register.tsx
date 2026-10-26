import type { Register } from 'claude-code'

const TOOL = 'mcp__heatmap__heatmap'

type RGB = [number, number, number]
type Map = {
  title: string
  rowLabels: string[]
  colLabels: string[]
  values: number[][]
  palette: 'heat' | 'green' | 'diverging'
  unit: string
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
const pack = (c: RGB) => (clamp(c[0]) << 16) | (clamp(c[1]) << 8) | clamp(c[2])
const DEFAULT = 0x01000000
const ramp = (stops: RGB[], k: number): RGB => {
  const t = Math.max(0, Math.min(0.9999, k)) * (stops.length - 1)
  const i = Math.floor(t)
  const a = stops[i]!
  const b = stops[i + 1]!
  const f = t - i
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}
const PALETTES: Record<Map['palette'], RGB[]> = {
  heat: [[18, 22, 48], [40, 70, 160], [30, 170, 170], [240, 210, 70], [235, 80, 50]],
  green: [[22, 27, 34], [14, 68, 41], [0, 109, 50], [38, 166, 65], [57, 211, 83]],
  diverging: [[50, 90, 200], [120, 170, 230], [235, 235, 235], [240, 150, 100], [200, 50, 50]],
}
const lum = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

const fmt = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : Number.isInteger(v) ? String(v) : v.toFixed(1)

// Printable width-1 characters only: anything else becomes '?'
const safe = (s: string) => s.replace(/[^\x20-\x7e]/g, '?')

const toBase64 = (words: Uint32Array) =>
  (new Uint8Array(words.buffer) as unknown as { toBase64: () => string }).toBase64()

const draw = (m: Map, width: number) => {
  const nr = m.values.length
  const nc = Math.max(...m.values.map(r => r.length), 1)
  const labelW = Math.min(16, Math.max(...m.rowLabels.map(l => l.length), 1)) + 1
  const cw = Math.max(2, Math.min(7, Math.floor((width - labelW) / nc)))
  const cols = Math.min(512, labelW + cw * nc)
  const rows = Math.min(256, nr + 1)

  const flat = m.values.flat().filter(v => Number.isFinite(v))
  const lo = Math.min(...flat)
  const hi = Math.max(...flat)
  const span = m.palette === 'diverging' ? Math.max(Math.abs(lo), Math.abs(hi)) || 1 : hi - lo || 1
  const kOf = (v: number) => (m.palette === 'diverging' ? (v / span + 1) / 2 : (v - lo) / span)

  const words = new Uint32Array(cols * rows * 3)
  const put = (r: number, c: number, ch: string, fg: number, bg: number) => {
    if (c >= cols || r >= rows) return
    const i = (r * cols + c) * 3
    words[i] = ch.charCodeAt(0)
    words[i + 1] = fg
    words[i + 2] = bg
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) put(r, c, ' ', DEFAULT, DEFAULT)

  // header row: column labels, truncated to the cell width
  for (let j = 0; j < nc; j++) {
    const label = safe(m.colLabels[j] ?? '').slice(0, cw - (cw > 2 ? 1 : 0))
    for (let k = 0; k < label.length; k++) put(0, labelW + j * cw + k, label[k]!, 0x9aa4b2, DEFAULT)
  }
  for (let i = 0; i < nr; i++) {
    const label = safe(m.rowLabels[i] ?? '').slice(0, labelW - 1)
    for (let k = 0; k < label.length; k++) put(i + 1, k, label[k]!, 0xc8cdd5, DEFAULT)
    for (let j = 0; j < nc; j++) {
      const v = m.values[i]?.[j]
      const has = typeof v === 'number' && Number.isFinite(v)
      const col: RGB = has ? ramp(PALETTES[m.palette], kOf(v)) : [40, 40, 40]
      const bg = pack(col)
      const fg = lum(col) > 140 ? 0x101010 : 0xf0f0f0
      const text = has ? fmt(v) : ''
      const showText = text.length <= cw - 1
      for (let k = 0; k < cw - (cw > 2 ? 1 : 0); k++) {
        const ch = showText ? (text[k - Math.floor((cw - 1 - text.length) / 2)] ?? ' ') : ' '
        put(i + 1, labelW + j * cw + k, ch, fg, bg)
      }
    }
  }
  return { cols, rows, cells: toBase64(words), lo, hi }
}

const legend = (m: Map, lo: number, hi: number, n = 24) => {
  const words = new Uint32Array(n * 3)
  for (let k = 0; k < n; k++) {
    words[k * 3] = 0x2588
    words[k * 3 + 1] = pack(ramp(PALETTES[m.palette], k / (n - 1)))
    words[k * 3 + 2] = DEFAULT
  }
  return { n, cells: toBase64(words), lo, hi }
}

// The result travels as JSON text (a string, or text content blocks)
const parseOutput = (out: unknown): Map | null => {
  const text = typeof out === 'string' ? out
    : Array.isArray(out) ? out.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
    : out && typeof out === 'object' ? JSON.stringify(out) : ''
  try {
    const m = JSON.parse(text) as Map
    return Array.isArray(m.values) ? m : null
  } catch {
    return null
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'heatmap',
      description:
        'Draw a truecolor heatmap inline in the chat for the user. Use whenever a grid of numbers ' +
        '(activity by day x hour, scores by item x criterion, a correlation or comparison matrix) is clearer as colour. ' +
        'values is rows x columns. palette: heat (default), green (activity/streaks), diverging (signed data, centred on 0). ' +
        'Keep it under 30 rows and 40 columns; labels short.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          rowLabels: { type: 'array', items: { type: 'string' } },
          colLabels: { type: 'array', items: { type: 'string' } },
          values: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
          palette: { type: 'string', enum: ['heat', 'green', 'diverging'] },
          unit: { type: 'string', description: 'unit shown in the legend, e.g. "msgs" or "%"' },
        },
        required: ['title', 'rowLabels', 'colLabels', 'values'],
      },
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Partial<Map>
    const values = Array.isArray(input.values) ? input.values.slice(0, 30).map(r => (Array.isArray(r) ? r.slice(0, 40).map(Number) : [])) : []
    if (values.length === 0) return { deny: 'heatmap: values must be a non-empty rows x columns array of numbers.' }
    const map: Map = {
      title: String(input.title ?? 'Heatmap'),
      rowLabels: (input.rowLabels ?? []).map(String),
      colLabels: (input.colLabels ?? []).map(String),
      values,
      palette: input.palette === 'green' || input.palette === 'diverging' ? input.palette : 'heat',
      unit: String(input.unit ?? ''),
    }
    const flat = values.flat().filter(Number.isFinite)
    return {
      result: JSON.stringify({
        ...map,
        summary: `Drew "${map.title}" (${values.length}x${Math.max(...values.map(r => r.length))}) for the user, range ${Math.min(...flat)} to ${Math.max(...flat)}.`,
      }),
    }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== TOOL || e.props.isErrored || e.surface !== 'terminal') return next(e)
    const m = parseOutput(e.props.output)
    if (!m) return next(e)
    const { Box, Text, Raster } = $.ui.resolve(e)
    const width = Math.max(30, (e.viewport?.columns ?? 100) - 6)
    const g = draw(m, width)
    const lg = legend(m, g.lo, g.hi)
    const unit = m.unit ? ` ${m.unit}` : ''
    return (
      <Box flexDirection="column">
        <Text bold>{m.title}</Text>
        <Raster key={`hm-${e.props.tool_use_id}`} columns={g.cols} rows={g.rows} cells={g.cells} />
        <Box gap={1}>
          <Text dimColor>{fmt(g.lo)}{unit}</Text>
          <Raster key={`lg-${e.props.tool_use_id}`} columns={lg.n} rows={1} cells={lg.cells} />
          <Text dimColor>{fmt(g.hi)}{unit}</Text>
        </Box>
      </Box>
    )
  })
}
