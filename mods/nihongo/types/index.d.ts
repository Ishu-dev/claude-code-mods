export type Mode = 'home' | 'kana' | 'words' | 'sentence'

export type Card = {
  key: string
  front: string
  back: string
  speak: string
  extra: string
}

export type Ui = {
  mode: Mode
  card: Card | null
  n: number
  revealed: boolean
  result: 'idle' | 'right' | 'wrong'
  feedback: string
  fix: string
  busy: boolean
  right: number
  wrong: number
  error: string
}

export type Word = { jp: string; reading: string; en: string }
export type Tally = { r: number; w: number }

declare module 'claude-code' {
  interface PluginState {
    nihongo: {
      ui: Ui
      band: Word | null
      isBandOn: boolean
      stats: Record<string, Tally>
      days: string[]
    }
  }
}
