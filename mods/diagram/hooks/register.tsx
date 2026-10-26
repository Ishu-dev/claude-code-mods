import type { Register } from 'claude-code'

const TOOL = 'mcp__diagram__diagram'

type Tone = 'start' | 'step' | 'decision' | 'end' | 'warn' | 'good'
type Node = { id: string; label: string; note?: string; tone?: Tone }
type Edge = { from: string; to: string; label?: string }
type Chart = { title: string; nodes: Node[]; edges: Edge[] }

const TONE: Record<Tone, { border: string; text: string; style: string }> = {
  start: { border: 'cyan', text: 'cyan', style: 'round' },
  step: { border: 'blue', text: 'white', style: 'round' },
  decision: { border: 'yellow', text: 'yellow', style: 'double' },
  end: { border: 'green', text: 'green', style: 'bold' },
  warn: { border: 'red', text: 'red', style: 'round' },
  good: { border: 'green', text: 'green', style: 'round' },
}

// Layered layout: each node's rank is its longest path from a source
const layers = (c: Chart): Node[][] => {
  const rank = new Map<string, number>(c.nodes.map(n => [n.id, 0]))
  for (let pass = 0; pass < c.nodes.length; pass++) {
    let changed = false
    for (const e of c.edges) {
      const r = (rank.get(e.from) ?? 0) + 1
      if (rank.has(e.to) && r > (rank.get(e.to) ?? 0) && r < c.nodes.length) {
        rank.set(e.to, r)
        changed = true
      }
    }
    if (!changed) break
  }
  const out: Node[][] = []
  for (const n of c.nodes) {
    const r = rank.get(n.id) ?? 0
    ;(out[r] ??= []).push(n)
  }
  return out.filter(Boolean)
}

const parse = (out: unknown): Chart | null => {
  const text = typeof out === 'string' ? out
    : Array.isArray(out) ? out.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
    : ''
  try {
    const c = JSON.parse(text) as Chart
    return Array.isArray(c.nodes) && c.nodes.length > 0 ? c : null
  } catch {
    return null
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'diagram',
      description:
        'Draw a flowchart inline in the chat (boxes and arrows, laid out top to bottom). Use to explain a process, a decision, ' +
        'a framework or an architecture visually, like a mermaid chart. Keep labels under 28 characters, notes under 50, at most 14 nodes. ' +
        'tone per node: start | step | decision | end | warn | good. Edges may carry a short label (e.g. "yes", "no").',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' }, label: { type: 'string' }, note: { type: 'string' },
                tone: { type: 'string', enum: ['start', 'step', 'decision', 'end', 'warn', 'good'] },
              },
              required: ['id', 'label'],
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
              required: ['from', 'to'],
            },
          },
        },
        required: ['title', 'nodes', 'edges'],
      },
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Partial<Chart>
    const nodes = (input.nodes ?? []).slice(0, 14).map(n => ({ ...n, id: String(n.id), label: String(n.label) }))
    if (nodes.length === 0) return { deny: 'diagram: give at least one node.' }
    const ids = new Set(nodes.map(n => n.id))
    const edges = (input.edges ?? []).filter(x => ids.has(String(x.from)) && ids.has(String(x.to)))
    return { result: JSON.stringify({ title: String(input.title ?? 'Diagram'), nodes, edges }) }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== TOOL || e.props.isErrored) return next(e)
    const c = parse(e.props.output)
    if (!c) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rows = layers(c)
    const width = Math.max(40, (e.viewport?.columns ?? 100) - 8)
    const labelOf = new Map(c.nodes.map(n => [n.id, n.label]))

    return (
      <Box flexDirection="column" alignItems="center" width={width}>
        <Text bold>{c.title}</Text>
        {rows.map((layer, i) => {
          const ids = new Set(layer.map(n => n.id))
          const out = c.edges.filter(x => ids.has(x.from))
          return (
            <Box key={`layer-${i}`} flexDirection="column" alignItems="center">
              <Box flexDirection="row" gap={2} justifyContent="center" flexWrap="wrap">
                {layer.map(n => {
                  const t = TONE[n.tone ?? 'step'] ?? TONE.step
                  return (
                    <Box key={`n-${n.id}`} borderStyle={t.style} borderColor={t.border} paddingX={1} flexDirection="column" alignItems="center">
                      <Text bold color={t.text}>{n.tone === 'decision' ? `◆ ${n.label} ?` : n.label}</Text>
                      {n.note ? <Text dimColor>{n.note}</Text> : null}
                    </Box>
                  )
                })}
              </Box>
              {i < rows.length - 1 && out.length > 0 && (
                <Box flexDirection="column" alignItems="center">
                  <Text color="gray">│</Text>
                  {out.some(x => x.label) || layer.length > 1 || out.length > 1
                    ? out.map((x, k) => (
                      <Text key={`e-${i}-${k}`} dimColor>
                        {labelOf.get(x.from)}<Text color="magenta"> ──{x.label ? ` ${x.label} ` : ''}──▶ </Text>{labelOf.get(x.to)}
                      </Text>
                    ))
                    : null}
                  <Text color="gray">▼</Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
