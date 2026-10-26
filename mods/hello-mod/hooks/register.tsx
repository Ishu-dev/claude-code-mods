import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Turn } from '../types'

const last = atom({ plugin: 'hello-mod', key: 'last' } as const, null)
const isHidden = atom({ plugin: 'hello-mod', key: 'isHidden' } as const, false)

export const register: Register = on => {
  let startedAt = 0
  let tools = 0

  // 1. Instant slash command: answered by code, no Claude turn
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hi', description: 'hello-mod: instant reply, no Claude turn' })
    return next(e)
  })

  on('command.run', { command: 'hi' }, async () => ({
    text: `Hi Ishu. This reply came from hello-mod code, not from Claude. Tool calls so far this turn: ${tools}.`,
  }))

  // 2. Guard: block destructive Bash before it runs
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    tools += 1
    return /\brm\s+-rf\b/.test(e.command)
      ? { deny: `hello-mod blocked this: "rm -rf" is not allowed in this session.` }
      : next(e)
  })

  on('tool.call', ($, e, next) => {
    if (e.tool !== 'Bash') tools += 1
    return next(e)
  })

  // 3. Band above the prompt: stats of the last turn
  on('prompt.submit', async ($, e, next) => {
    startedAt = await $.clock.now()
    tools = 0
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const seconds = Math.round(((await $.clock.now()) - startedAt) / 1000)
    const turn: Turn = { seconds, tools }
    await update($, last, () => turn)
    $.ui.toast(`hello-mod: turn done in ${seconds}s`)
    return next(e)
  })
}
