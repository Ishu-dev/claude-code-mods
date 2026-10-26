export type Phase = 'idle' | 'asking' | 'ready' | 'recording' | 'transcribing' | 'scoring' | 'done' | 'error'
export type View = 'summary' | 'breakdown' | 'better' | 'transcript'

export type Part = {
  label: string
  said: string
  fix: string
  verdict: 'strong' | 'weak' | 'missing'
  words: number
  idealShare: number
}

export type Better = { title: string; why: string; outline: string }

export type Coach = {
  phase: Phase
  view: View
  track: string
  question: string
  seconds: number
  spoken: number
  idealMin: number
  idealMax: number
  transcript: string
  words: number
  wpm: number
  fillers: number
  fillerWords: string
  framework: string
  parts: Part[]
  better: Better[]
  verdict: string
  fixNext: string
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'interview-coach': { coach: Coach; history: number[] }
  }
}
