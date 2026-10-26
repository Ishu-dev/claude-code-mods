import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Mood, Place } from '../types'

const mood = atom({ plugin: 'avatar', key: 'mood' } as const, 'idle')
const line = atom({ plugin: 'avatar', key: 'line' } as const, 'Hi Ishu.')
const place = atom({ plugin: 'avatar', key: 'place' } as const, 'side')
const PANE = 'buddy'
const PLACES: Place[] = ['side', 'right', 'left', 'mini', 'off']

// One-line text faces for the compact places
const face = (m: Mood, t: number) => {
  if (m === 'happy') return '(^‿^)'
  if (m === 'worried') return '(°﹏°;)'
  if (m === 'sleepy') return ['(-_-) z', '(-_-) zZ', '(-_-) zZz'][Math.floor(t) % 3]!
  if (m === 'thinking') return ['( •_•)', '(•_• )'][Math.floor(t * 2) % 2]!
  return t % 4 < 0.4 ? '(-‿-)' : '(•‿•)'
}

const W = 16
const PH = 16 // pixel rows; drawn as 8 terminal rows
const ROWS = PH / 2

const LINES: Record<Mood, string[]> = {
  idle: ['Ready when you are.', 'Slow pace wins interviews.', 'Breathe in 4, out 6.', 'Day 0 is close. You are prepared.'],
  thinking: ['On it...', 'Thinking this through...', 'Working on it...'],
  happy: ['Done!', 'That worked.', 'Nice, shipped.'],
  worried: ['Hmm, that failed. Fixing it.', 'Small hiccup, trying again.'],
  sleepy: ['It is late. Sleep is a placement strategy.', 'Zzz... wrap up soon?'],
}
const pick = (m: Mood) => LINES[m][Math.floor(Math.random() * LINES[m].length)]!

type RGB = [number, number, number]
const pack = (c: RGB) => (c[0] << 16) | (c[1] << 8) | c[2]
const NONE = 0x01000000
const BODY: RGB = [217, 119, 87]
const SHADE: RGB = [180, 90, 64]
const LIGHT: RGB = [240, 160, 125]
const INK: RGB = [30, 22, 20]
const CHEEK: RGB = [235, 110, 120]
const WHITE: RGB = [250, 245, 240]

// Draw one frame of the sprite as a pixel grid (null = transparent)
const sprite = (m: Mood, t: number): (RGB | null)[][] => {
  const g: (RGB | null)[][] = Array.from({ length: PH }, () => Array<RGB | null>(W).fill(null))
  const bounce = m === 'happy' ? Math.round(Math.abs(Math.sin(t * 6))) : m === 'thinking' ? Math.round((Math.sin(t * 4) + 1) / 2) : 0
  const breathe = m === 'sleepy' ? (Math.sin(t * 1.5) > 0 ? 1 : 0) : 0
  const cx = 7.5
  const cy = 9 - bounce
  const rx = 6.6 + breathe * 0.4
  const ry = 6 - breathe * 0.3
  const set = (x: number, y: number, c: RGB) => { if (x >= 0 && x < W && y >= 0 && y < PH) g[y]![x] = c }

  // body with a little shading
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < W; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
      if (d <= 1) set(x, y, d > 0.7 && x > cx ? SHADE : x < cx - 2 && y < cy - 2 ? LIGHT : BODY)
    }
  }
  // antenna sprout
  set(7, Math.round(cy - ry - 1), SHADE)
  set(8, Math.round(cy - ry - 2), m === 'happy' ? [255, 210, 90] : LIGHT)

  // eyes
  const ey = Math.round(cy - 1)
  const look = m === 'thinking' ? (Math.sin(t * 2) > 0 ? 1 : -1) : 0
  const blink = m === 'idle' && t % 4 < 0.15
  for (const ex of [5 + look, 10 + look]) {
    if (m === 'sleepy' || blink) {
      set(ex, ey + 1, INK); set(ex + 1, ey + 1, INK)
    } else if (m === 'happy') {
      set(ex, ey + 1, INK); set(ex + 1, ey, INK); set(ex + 2, ey + 1, INK) // ^ eyes
    } else {
      set(ex, ey, INK); set(ex, ey + 1, INK); set(ex + 1, ey, WHITE); set(ex + 1, ey + 1, INK)
    }
  }
  if (m === 'worried') { set(4, ey - 2, INK); set(5, ey - 3, INK); set(11, ey - 3, INK); set(12, ey - 2, INK) }

  // cheeks
  if (m === 'happy' || m === 'idle') { set(3, ey + 2, CHEEK); set(13, ey + 2, CHEEK) }

  // mouth
  const my = ey + 3
  if (m === 'happy') { for (let x = 6; x <= 10; x++) set(x, my, INK); set(5, my - 1, INK); set(11, my - 1, INK); set(8, my + 1, CHEEK) }
  else if (m === 'worried') { set(6, my + 1, INK); set(7, my, INK); set(8, my, INK); set(9, my + 1, INK); set(10, my, INK) }
  else if (m === 'sleepy') { set(8, my, INK) }
  else if (m === 'thinking') { set(7, my, INK); set(8, my, INK); set(9, my, INK) }
  else { set(7, my, INK); set(8, my + (t % 3 < 1.5 ? 0 : 0), INK); set(9, my, INK) }

  // sweat drop when worried, Zzz pixels when sleepy
  if (m === 'worried') { set(14, ey - 1, [120, 190, 255]); set(14, ey, [120, 190, 255]) }
  if (m === 'sleepy') { const z = Math.floor(t * 1.5) % 3; for (let k = 0; k <= z; k++) set(12 + k, 3 - k, WHITE) }
  return g
}

const toCells = (g: (RGB | null)[][]) => {
  const words = new Uint32Array(W * ROWS * 3)
  for (let r = 0; r < ROWS; r++) {
    for (let x = 0; x < W; x++) {
      const top = g[r * 2]![x]
      const bot = g[r * 2 + 1]![x]
      const i = (r * W + x) * 3
      words[i] = top || bot ? 0x2580 : 0x20
      words[i + 1] = top ? pack(top) : NONE
      words[i + 2] = bot ? pack(bot) : NONE
    }
  }
  return (new Uint8Array(words.buffer) as unknown as { toBase64: () => string }).toBase64()
}

export const register: Register = on => {
  let current: Mood = 'idle'
  let paneShown = false
  let textPlace = false
  let tick = 0
  let moodUntil = 0
  let working = false

  const isLate = () => { const h = new Date().getHours(); return h >= 0 && h < 5 }
  const resting = (): Mood => (isLate() ? 'sleepy' : 'idle')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'buddy',
      description: 'Move the avatar buddy: side (right dock), right or left (one line above prompt), mini (in the hint line), off',
      argumentHint: 'side | right | left | mini | off',
    })
    const setMood = async (m: Mood) => {
      if (m === current) return
      current = m
      await update($, mood, () => m)
      await update($, line, () => pick(m))
    }
    // animate the sprite and drift moods back to resting
    $.clock.every(120, () => {
      const now = Date.now()
      if (!working && now > moodUntil && current !== resting()) void setMood(resting())
      if (working && now > moodUntil && current !== 'thinking') void setMood('thinking')
      if (paneShown) void $.ui.blit({ requestId: PANE, key: 'buddy', cells: toCells(sprite(current, now / 1000)) }).catch(() => {})
      tick += 1
      if (tick % 4 === 0 && textPlace) $.ui.invalidate('ui.render')
    })
    const saved = (await $.store.get('place')) as Place | undefined
    const p = saved && PLACES.includes(saved) ? saved : 'side'
    await update($, place, () => p)
    if (p === 'side') void $.ui.open({ id: PANE, title: 'Buddy', columns: 22, rows: 9 })
    await update($, mood, () => resting())
    current = resting()
    await update($, line, () => pick(current))
    return next(e)
  })

  on('command.run', { command: 'buddy' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase() as Place
    const cur = await read($, place)
    const nextPlace: Place = PLACES.includes(asked) ? asked : PLACES[(PLACES.indexOf(cur) + 1) % PLACES.length]!
    await update($, place, () => nextPlace)
    await $.store.set('place', nextPlace)
    if (nextPlace === 'side') await $.ui.open({ id: PANE, title: 'Buddy', columns: 22, rows: 9 })
    else if (cur === 'side') { paneShown = false; await $.ui.close({ id: PANE }).catch(() => {}) }
    const where: Record<Place, string> = {
      side: 'docked on the right beside the chat',
      right: 'one line above the prompt, right side',
      left: 'one line above the prompt, left side',
      mini: 'inside the hint line under the prompt (takes no space)',
      off: 'hidden',
    }
    return { text: `Buddy is now ${where[nextPlace]}. /buddy side | right | left | mini | off` }
  })

  on('prompt.submit', async ($, e, next) => {
    working = true
    moodUntil = 0
    current = 'thinking'
    await update($, mood, () => 'thinking')
    await update($, line, () => pick('thinking'))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) {
      current = 'worried'
      moodUntil = Date.now() + 5000
      await update($, mood, () => 'worried')
      await update($, line, () => pick('worried'))
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    working = false
    current = 'happy'
    moodUntil = Date.now() + 6000
    await update($, mood, () => 'happy')
    await update($, line, () => pick('happy'))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, place)
    textPlace = p === 'right' || p === 'left' || p === 'mini'
    if (e.props.hasSurvey || (p !== 'right' && p !== 'left')) return next(e)
    const m = await read($, mood)
    const said = await read($, line)
    const { Box, Text } = $.ui.resolve(e)
    const color = m === 'worried' ? 'red' : m === 'happy' ? 'green' : m === 'sleepy' ? 'magenta' : 'cyan'
    return (
      <Box flexDirection="row" justifyContent={p === 'right' ? 'flex-end' : 'flex-start'} width="100%">
        <Text color={color} bold>{face(m, Date.now() / 1000)}</Text>
        <Text dimColor> {said}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if ((await read($, place)) !== 'mini') return next(e)
    const m = await read($, mood)
    const said = await read($, line)
    return next({ ...e, props: { ...e.props, tail: `  ${face(m, Date.now() / 1000)} ${said}` } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    paneShown = true
    const m = await read($, mood)
    const said = await read($, line)
    const { Box, Text } = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : null
    const color = m === 'worried' ? 'red' : m === 'happy' ? 'green' : m === 'sleepy' ? 'magenta' : 'cyan'
    return (
      <Box flexDirection="column" alignItems="center">
        {Raster
          ? <Raster key="buddy" columns={W} rows={ROWS} cells={toCells(sprite(m, Date.now() / 1000))} />
          : <Text>{face(m, Date.now() / 1000)}</Text>}
        <Text color={color} wrap="wrap">{said}</Text>
      </Box>
    )
  })
}
