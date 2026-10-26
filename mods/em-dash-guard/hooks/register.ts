import type { Register } from 'claude-code'

const DASH = '—'
const EXEMPT = /linkedin/i
const count = (s: string) => s.split(DASH).length - 1

export const register: Register = on => {
  on('tool.call', { tool: 'Write' }, ($, e, next) =>
    !EXEMPT.test(e.file_path) && count(e.content) > 0
      ? { deny: `em-dash-guard: ${e.file_path} would contain ${count(e.content)} em dash(es). Ishu bans them; reword with commas, colons or parentheses.` }
      : next(e),
  )

  on('tool.call', { tool: 'Edit' }, ($, e, next) =>
    !EXEMPT.test(e.file_path) && count(e.new_string) > count(e.old_string)
      ? { deny: `em-dash-guard: this edit adds an em dash to ${e.file_path}. Reword without it.` }
      : next(e),
  )
}
