export type Change = { path: string; edits: number; tool: string }

declare module 'claude-code' {
  interface PluginState {
    'change-ledger': { changes: Change[] }
  }
}
