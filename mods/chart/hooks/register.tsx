import type { Register } from 'claude-code'

const TOOL = 'mcp__chart__chart'

type Kind = 'bar' | 'line' | 'area' | 'donut'
type Series = { name: string; values: number[] }
type Chart = { title: string; kind: Kind; labels: string[]; series: Series[]; unit: string }

const PALETTE = ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#b388ff', '#ff8c42', '#90e0ef', '#ef476f']
const hex = (h: string) => parseInt(h.slice(1), 16)
const NONE = 0x01000000
const GRID = 0x2a2f3a

const fmt = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k`
  : Number.isInteger(v) ? String(v) : v.toFixed(1)

const b64 = (w: Uint32Array) => (new Uint8Array(w.buffer) as unknown as { toBase64: () => string }).toBase64()

// A pixel canvas drawn with half blocks: 2 pixels per terminal row
const canvas = (cols: number, rows: number) => {
  const ph = rows * 2
  const px = new Uint32Array(cols * ph).fill(NONE)
  return {
    ph,
    set: (x: number, y: number, c: number) => {
      const xi = Math.round(x)
      const yi = Math.round(y)
      if (xi >= 0 && xi < cols && yi >= 0 && yi < ph) px[yi * cols + xi] = c
    },
    get: (x: number, y: number) => px[y * cols + x]!,
    cells: () => {
      const w = new Uint32Array(cols * rows * 3)
      for (let r = 0; r < rows; r++) {
        for (let x = 0; x < cols; x++) {
          const top = px[r * 2 * cols + x]!
          const bot = px[(r * 2 + 1) * cols + x]!
          const i = (r * cols + x) * 3
          w[i] = top === NONE && bot === NONE ? 0x20 : 0x2580
          w[i + 1] = top
          w[i + 2] = bot
        }
      }
      return b64(w)
    },
  }
}

const line = (set: (x: number, y: number, c: number) => void, x0: number, y0: number, x1: number, y1: number, c: number) => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let k = 0; k <= n; k++) set(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, c)
}

const parse = (out: unknown): Chart | null => {
  const text = typeof out === 'string' ? out
    : Array.isArray(out) ? out.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
    : ''
  try {
    const c = JSON.parse(text) as Chart
    return Array.isArray(c.series) && c.series.length > 0 ? c : null
  } catch {
    return null
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'chart',
      description:
        'Draw a chart inline in the chat in true colour. kind: bar (compare categories, horizontal bars, grouped when several series), ' +
        'line (trend over labels, several series), area (one or two series, filled), donut (shares of a whole; uses the first series). ' +
        'labels are the categories or x points; each series has a name and one value per label. Keep under 40 labels and 6 series.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['bar', 'line', 'area', 'donut'] },
          labels: { type: 'array', items: { type: 'string' } },
          series: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }, required: ['name', 'values'] },
          },
          unit: { type: 'string' },
        },
        required: ['title', 'kind', 'labels', 'series'],
      },
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Partial<Chart>
    const labels = (input.labels ?? []).slice(0, 40).map(String)
    const series = (input.series ?? []).slice(0, 6).map(s => ({ name: String(s.name), values: (s.values ?? []).slice(0, 40).map(Number) }))
    if (labels.length === 0 || series.length === 0) return { deny: 'chart: give labels and at least one series.' }
    const kind: Kind = ['bar', 'line', 'area', 'donut'].includes(String(input.kind)) ? (input.kind as Kind) : 'bar'
    return { result: JSON.stringify({ title: String(input.title ?? 'Chart'), kind, labels, series, unit: String(input.unit ?? '') }) }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== TOOL || e.props.isErrored || e.surface !== 'terminal') return next(e)
    const c = parse(e.props.output)
    if (!c) return next(e)
    const { Box, Text, Raster } = $.ui.resolve(e)
    const width = Math.max(40, Math.min(140, (e.viewport?.columns ?? 100) - 8))
    const unit = c.unit ? ` ${c.unit}` : ''
    const all = c.series.flatMap(s => s.values).filter(Number.isFinite)
    const max = Math.max(...all, 0)
    const min = Math.min(...all, 0)
    const legend = c.series.length > 1 || c.kind === 'donut'

    const legendOf = (items: { name: string; color: string; extra?: string }[]) => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {items.map((it, i) => (
          <Text key={`lg-${i}`}><Text color={it.color}>■</Text> {it.name}{it.extra ? <Text dimColor> {it.extra}</Text> : ''}</Text>
        ))}
      </Box>
    )

    if (c.kind === 'bar') {
      const labelW = Math.min(18, Math.max(...c.labels.map(l => l.length)))
      const barW = Math.max(10, width - labelW - 12)
      return (
        <Box flexDirection="column">
          <Text bold>{c.title}</Text>
          {c.labels.map((lab, i) => (
            <Box key={`row-${i}`} flexDirection="column">
              {c.series.map((s, k) => {
                const v = s.values[i] ?? 0
                const n = max > 0 ? Math.max(0, Math.round((v / max) * barW)) : 0
                const color = PALETTE[k % PALETTE.length]!
                return (
                  <Text key={`b-${i}-${k}`}>
                    <Text dimColor>{(k === 0 ? lab : '').slice(0, labelW).padEnd(labelW)} </Text>
                    <Text color={color}>{'█'.repeat(n)}{n === 0 ? '▏' : ''}</Text>
                    <Text> {fmt(v)}{unit}</Text>
                  </Text>
                )
              })}
            </Box>
          ))}
          {legend && legendOf(c.series.map((s, k) => ({ name: s.name, color: PALETTE[k % PALETTE.length]! })))}
        </Box>
      )
    }

    if (c.kind === 'donut') {
      const s = c.series[0]!
      const vals = c.labels.map((_, i) => Math.max(0, s.values[i] ?? 0))
      const total = vals.reduce((a, b) => a + b, 0) || 1
      const rows = 12
      const cols = rows * 2 + 2
      const cv = canvas(cols, rows)
      const cx = (cols - 1) / 2
      const cy = (cv.ph - 1) / 2
      const R = Math.min(cx, cy)
      const ends: number[] = []
      vals.reduce((acc, v) => { ends.push(acc + v / total); return acc + v / total }, 0)
      for (let y = 0; y < cv.ph; y++) {
        for (let x = 0; x < cols; x++) {
          const d = Math.hypot(x - cx, y - cy)
          if (d > R || d < R * 0.55) continue
          const a = ((Math.atan2(y - cy, x - cx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)
          const idx = ends.findIndex(t => a <= t)
          cv.set(x, y, hex(PALETTE[(idx < 0 ? ends.length - 1 : idx) % PALETTE.length]!))
        }
      }
      return (
        <Box flexDirection="column">
          <Text bold>{c.title}</Text>
          <Box flexDirection="row" gap={3} alignItems="center">
            <Raster key={`d-${e.props.tool_use_id}`} columns={cols} rows={rows} cells={cv.cells()} />
            <Box flexDirection="column">
              {c.labels.map((lab, i) => (
                <Text key={`dl-${i}`}>
                  <Text color={PALETTE[i % PALETTE.length]}>■</Text> {lab}
                  <Text dimColor>  {fmt(vals[i]!)}{unit}  {Math.round((vals[i]! / total) * 100)}%</Text>
                </Text>
              ))}
              <Text dimColor>total {fmt(total)}{unit}</Text>
            </Box>
          </Box>
        </Box>
      )
    }

    // line and area: pixel plot with y labels on the left and x labels below
    const yLabW = Math.max(fmt(max).length, fmt(min).length) + unit.length + 1
    const cols = Math.min(512, width - yLabW - 2)
    const rows = 12
    const cv = canvas(cols, rows)
    const span = max - min || 1
    const yOf = (v: number) => (cv.ph - 1) - ((v - min) / span) * (cv.ph - 1)
    const n = c.labels.length
    const xOf = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (cols - 1))
    for (let k = 0; k <= 4; k++) {
      const y = Math.round(((cv.ph - 1) * k) / 4)
      for (let x = 0; x < cols; x += 2) cv.set(x, y, GRID)
    }
    c.series.forEach((s, k) => {
      const color = hex(PALETTE[k % PALETTE.length]!)
      if (c.kind === 'area') {
        const fill = ((color >> 1) & 0x7f7f7f)
        for (let x = 0; x < cols; x++) {
          const t = n <= 1 ? 0 : (x / (cols - 1)) * (n - 1)
          const i = Math.floor(t)
          const v = (s.values[i] ?? 0) + ((s.values[Math.min(n - 1, i + 1)] ?? 0) - (s.values[i] ?? 0)) * (t - i)
          for (let y = Math.round(yOf(v)); y < cv.ph; y++) cv.set(x, y, fill)
        }
      }
      for (let i = 0; i < n - 1; i++) line(cv.set, xOf(i), yOf(s.values[i] ?? 0), xOf(i + 1), yOf(s.values[i + 1] ?? 0), color)
      for (let i = 0; i < n; i++) cv.set(xOf(i), yOf(s.values[i] ?? 0), 0xffffff)
    })
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(cols / 8))))
    let xAxis = ''
    for (let i = 0; i < n; i += step) {
      const pos = Math.round(xOf(i))
      xAxis = xAxis.padEnd(pos) + c.labels[i]!.slice(0, 7)
    }
    return (
      <Box flexDirection="column">
        <Text bold>{c.title}</Text>
        <Box flexDirection="row">
          <Box flexDirection="column" width={yLabW} height={rows} justifyContent="space-between">
            <Text dimColor>{fmt(max)}{unit}</Text>
            <Text dimColor>{fmt((max + min) / 2)}</Text>
            <Text dimColor>{fmt(min)}{unit}</Text>
          </Box>
          <Raster key={`l-${e.props.tool_use_id}`} columns={cols} rows={rows} cells={cv.cells()} />
        </Box>
        <Text dimColor>{' '.repeat(yLabW)}{xAxis.slice(0, cols)}</Text>
        {legend && legendOf(c.series.map((s, k) => ({ name: s.name, color: PALETTE[k % PALETTE.length]! })))}
      </Box>
    )
  })
}
