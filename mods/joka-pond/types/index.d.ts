export type Pond = {
  xp: number
  streak: number
  stormUntil: number
  partyUntil: number
  log: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'joka-pond': { frame: number; pond: Pond }
  }
}
