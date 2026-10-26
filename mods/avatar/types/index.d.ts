export type Mood = 'idle' | 'thinking' | 'happy' | 'worried' | 'sleepy'
export type Place = 'side' | 'right' | 'left' | 'mini' | 'off'

declare module 'claude-code' {
  interface PluginState {
    avatar: { mood: Mood; line: string; place: Place }
  }
}
