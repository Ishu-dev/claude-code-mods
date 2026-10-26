export type Scene = 'aurora' | 'plasma' | 'sunset' | 'warp' | 'breathe'

declare module 'claude-code' {
  interface PluginState {
    aurora: { scene: Scene; isBandOn: boolean }
  }
}
