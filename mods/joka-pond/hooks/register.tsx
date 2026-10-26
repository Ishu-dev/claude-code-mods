import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Pond } from '../types'

const PANE = 'joka-pond'
const frame = atom({ plugin: 'joka-pond', key: 'frame' } as const, 0)
const pond = atom({ plugin: 'joka-pond', key: 'pond' } as const, { xp: 0, streak: 0, stormUntil: 0, partyUntil: 0, log: [] })

const LADDER = [
  { at: 0, title: 'Intern' },
  { at: 100, title: 'Analyst' },
  { at: 300, title: 'Associate' },
  { at: 700, title: 'Engagement Manager' },
  { at: 1500, title: 'Principal' },
  { at: 3000, title: 'Partner' },
  { at: 6000, title: 'Managing Partner' },
]
const levelOf = (xp: number) => LADDER.reduce((lv, step, i) => (xp >= step.at ? i : lv), 0)

const XP: Record<string, number> = { Write: 15, Edit: 10, Bash: 6, Agent: 20, WebSearch: 8, Read: 2, Grep: 2, Glob: 2 }

// Small deterministic noise so the scene is stable between redraws of one frame
const noise = (a: number, b: number) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export const register: Register = on => {
  let tick = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pond', description: 'Open Joka Pond: your animated XP pond' })

    // Load saved progress and update the daily streak
    const saved = ((await $.store.get('pond')) as Partial<Pond> | undefined) ?? {}
    const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
    const lastDay = ((await $.store.get('lastDay')) as string | undefined) ?? ''
    const yesterday = new Date((await $.clock.now()) - 86400000).toISOString().slice(0, 10)
    const streak = lastDay === today ? saved.streak ?? 1 : lastDay === yesterday ? (saved.streak ?? 0) + 1 : 1
    await $.store.set('lastDay', today)
    await update($, pond, () => ({ xp: saved.xp ?? 0, streak, stormUntil: 0, partyUntil: 0, log: [] }))

    // The animation clock: 5 frames a second
    $.clock.every(200, () => {
      tick += 1
      void update($, frame, () => tick)
    })

    return next(e)
  })

  on('command.run', { command: 'pond' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Joka Pond' })
    const p = await read($, pond)
    return { text: `Joka Pond opened. ${LADDER[levelOf(p.xp)]!.title}, ${p.xp} XP, ${p.streak}-day streak.` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const failed = ran.deny !== undefined || ran.isError === true
    const before = await read($, pond)
    const tool = 'tool' in e ? String(e.tool) : 'tool'
    const gain = failed ? -3 : XP[tool] ?? 3
    const xp = Math.max(0, before.xp + gain)
    const promoted = levelOf(xp) > levelOf(before.xp)
    const entry = failed ? `⛈  ${tool} failed  -3` : `+${gain}  ${tool}`

    const after: Pond = {
      ...before,
      xp,
      stormUntil: failed ? tick + 15 : before.stormUntil,
      partyUntil: promoted ? tick + 25 : before.partyUntil,
      log: [entry, ...before.log].slice(0, 4),
    }
    await update($, pond, () => after)
    await $.store.set('pond', after)

    if (promoted) {
      const title = LADDER[levelOf(xp)]!.title
      $.ui.toast(`🎉 Promoted to ${title}!`)
      void $.audio.speak(`Congratulations. You have been promoted to ${title}.`).catch(() => {})
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const f = await read($, frame)
    const p = await read($, pond)
    const W = Math.max(24, Math.min(70, (e.viewport?.columns ?? 50) - 2))
    const lv = levelOf(p.xp)
    const stormy = f < p.stormUntil
    const party = f < p.partyUntil
    const hour = new Date().getHours()
    const night = hour >= 19 || hour < 6

    // Sky: drifting stars or clouds, rain in a storm, confetti at a promotion
    const sky = [0, 1].map(row =>
      Array.from({ length: W }, (_, x) => {
        if (party && noise(x + f, row) > 0.8) return ['*', '+', '·', '✦'][Math.floor(noise(x, f + row) * 4)]!
        if (stormy) return noise(x + f * 2, row) > 0.7 ? '╱' : ' '
        if (row === 0 && x === W - 6) return night ? '☾' : '☀'
        if (night) return noise(x, row) > 0.93 ? (noise(x, f >> 2) > 0.5 ? '·' : '✧') : ' '
        return noise(Math.floor((x + f / 3) / 6), row) > 0.85 ? '░' : ' '
      }).join(''),
    )
    const skyColor = party ? 'magenta' : stormy ? 'gray' : night ? 'white' : 'yellow'

    // Lotus line: one bloom per level, gently bobbing
    const lotusRow = Array.from({ length: W }, (_, x) => {
      const slot = Math.floor(W / (lv + 2))
      const isLotus = x > 0 && x % slot === 0 && x / slot <= lv + 1
      return isLotus ? ((f >> 2) % 2 === 0 ? '✿' : '❀') : ' '
    }).join('')

    // Water with fish: more fish as the career grows
    const fishCount = Math.min(8, lv + 2)
    const water = [0, 1, 2].map(row => {
      const cells: string[] = Array.from({ length: W }, (_, x) => {
        const wave = (x + f + row * 3) % 7
        return row === 0 ? (wave < 2 ? '≈' : '~') : wave === 0 ? '~' : ' '
      })
      for (let i = 0; i < fishCount; i++) {
        if (i % 3 !== row) continue
        const speed = 1 + (i % 3)
        const span = W + 6
        const raw = (Math.floor((f * speed) / 2) + i * 13) % (span * 2)
        const right = raw < span
        const x = right ? raw - 3 : span * 2 - raw - 3
        const fish = right ? '><>' : '<><'
        for (let k = 0; k < 3; k++) if (x + k >= 0 && x + k < W) cells[x + k] = fish[k]!
        if (noise(i, f >> 1) > 0.85 && row > 0 && x + 1 >= 0 && x + 1 < W) cells[x + 1] = 'o'
      }
      return cells.join('')
    })

    const cur = LADDER[lv]!
    const nxt = LADDER[lv + 1]
    const pct = nxt ? (p.xp - cur.at) / (nxt.at - cur.at) : 1
    const barW = Math.max(10, W - 22)
    const fill = Math.round(pct * barW)
    const shimmer = (f >> 1) % Math.max(1, fill + 4)

    return (
      <Box flexDirection="column">
        {sky.map((line, i) => <Text key={`sky-${i}`} color={skyColor}>{line}</Text>)}
        <Text color="magenta">{lotusRow}</Text>
        {water.map((line, i) => {
          const base = stormy ? 'gray' : i === 0 ? 'cyan' : 'blue'
          const fishColor = stormy ? 'gray' : 'yellow'
          // group runs of fish and water characters so each run gets one colour
          const runs: { text: string; isFish: boolean }[] = []
          for (const ch of line) {
            const isFish = ch === '>' || ch === '<'
            const last = runs[runs.length - 1]
            if (last && last.isFish === isFish) last.text += ch
            else runs.push({ text: ch, isFish })
          }
          return (
            <Text key={`w-${i}`}>
              {runs.map((r, k) => <Text key={`r-${i}-${k}`} color={r.isFish ? fishColor : base}>{r.text}</Text>)}
            </Text>
          )
        })}
        <Text> </Text>
        <Text>
          <Text bold color={party ? 'magenta' : 'green'}>{party ? '🎉 ' : ''}{cur.title}</Text>
          <Text dimColor>  {p.xp} XP{nxt ? `, ${nxt.at - p.xp} to ${nxt.title}` : ', top of the firm'}</Text>
        </Text>
        <Text>
          {'['}
          {Array.from({ length: barW }, (_, i) =>
            i < fill ? (i === shimmer ? '▓' : '█') : '░').join('')}
          {']'} <Text dimColor>{Math.round(pct * 100)}%</Text>
        </Text>
        <Text dimColor>🔥 {p.streak}-day streak   {stormy ? 'storm passing...' : party ? 'promotion party!' : night ? 'night shift' : 'calm waters'}</Text>
        {p.log.map((l, i) => <Text key={`log-${i}`} color={l.startsWith('⛈') ? 'red' : 'green'} dimColor={i > 0}>{l}</Text>)}
      </Box>
    )
  })
}
