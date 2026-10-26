import type { Register } from 'claude-code'

const TOOL = 'mcp__pixel__pixel'

// A pixel file: { w, h, pixels: ["rrggbb", ...] } row-major, h even
type Pic = { w: number; h: number; pixels: string[] }
type Shown = { title: string; path: string }

const toBase64 = (words: Uint32Array) =>
  (new Uint8Array(words.buffer) as unknown as { toBase64: () => string }).toBase64()

// Two image rows per terminal row: upper half block, fg = top pixel, bg = bottom pixel
const cellsOf = (p: Pic) => {
  const rows = Math.ceil(p.h / 2)
  const words = new Uint32Array(p.w * rows * 3)
  const at = (x: number, y: number) => (y < p.h ? parseInt(p.pixels[y * p.w + x] ?? '000000', 16) : 0x01000000)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < p.w; x++) {
      const i = (r * p.w + x) * 3
      words[i] = 0x2580
      words[i + 1] = at(x, r * 2)
      words[i + 2] = at(x, r * 2 + 1)
    }
  }
  return { cols: p.w, rows, cells: toBase64(words) }
}

const parseShown = (out: unknown): Shown | null => {
  const text = typeof out === 'string' ? out
    : Array.isArray(out) ? out.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
    : ''
  try {
    const s = JSON.parse(text) as Shown
    return typeof s.path === 'string' ? s : null
  } catch {
    return null
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'pixel',
      description:
        'Draw a pixel-art image inline in the chat from a pixel file: JSON {w, h, pixels: ["rrggbb", ...]} row-major. ' +
        'Make the file first (e.g. with Python Pillow: resize to <= 100 px wide, quantize), then call this with its absolute path.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, title: { type: 'string' } },
        required: ['path'],
      },
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Partial<Shown>
    const path = String(input.path ?? '')
    const text = await $.fs.read(path).catch(() => '')
    try {
      const p = JSON.parse(text) as Pic
      if (!(p.w > 0 && p.h > 0 && Array.isArray(p.pixels) && p.pixels.length >= p.w * p.h)) throw new Error('shape')
      if (p.w > 200) return { deny: 'pixel: keep images at most 200 pixels wide.' }
    } catch {
      return { deny: `pixel: ${path} is not a pixel file ({w, h, pixels}).` }
    }
    return { result: JSON.stringify({ title: String(input.title ?? ''), path }) }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== TOOL || e.props.isErrored || e.surface !== 'terminal') return next(e)
    const s = parseShown(e.props.output)
    if (!s) return next(e)
    const text = await $.fs.read(s.path).catch(() => '')
    let pic: Pic
    try {
      pic = JSON.parse(text) as Pic
    } catch {
      return next(e)
    }
    const { Box, Text, Raster } = $.ui.resolve(e)
    const g = cellsOf(pic)
    return (
      <Box flexDirection="column">
        {s.title ? <Text bold>{s.title}</Text> : null}
        <Raster key={`px-${e.props.tool_use_id}`} columns={g.cols} rows={g.rows} cells={g.cells} />
      </Box>
    )
  })
}
