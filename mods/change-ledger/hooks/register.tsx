import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Change } from '../types'

const PANE = 'change-ledger'
const changes = atom({ plugin: 'change-ledger', key: 'changes' } as const, [])

const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'changes', description: 'Open a pane of files edited this session' })
    return next(e)
  })

  on('command.run', { command: 'changes' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Files changed' })
    const n = (await read($, changes)).length
    return { text: `Change ledger opened: ${n} file(s) so far.` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isWrite = e.tool === 'Write' || e.tool === 'Edit'
    if (!isWrite || ran.deny !== undefined || ran.isError === true) return ran

    const path = e.file_path
    await update($, changes, list => {
      const found = list.find(c => c.path === path)
      return found
        ? list.map(c => (c.path === path ? { ...c, edits: c.edits + 1, tool: e.tool } : c))
        : [...list, { path, edits: 1, tool: e.tool }].slice(-100)
    })
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, changes)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No files changed yet.</Text>}
        {list.slice(-room).map(c => (
          <Text key={c.path}>
            <Text color={c.tool === 'Write' ? 'green' : 'yellow'}>{c.tool === 'Write' ? 'new ' : 'edit'}</Text>
            {' '}{short(c.path)}<Text dimColor> x{c.edits}</Text>
          </Text>
        ))}
      </Box>
    )
  })
}
