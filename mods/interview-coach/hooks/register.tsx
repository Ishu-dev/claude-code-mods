import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Better, Coach, Part, View } from '../types'

const PANE = 'interview-coach'
const DIR = '/tmp/interview-coach'
const RAW = `${DIR}/answer.raw`
const WAV = `${DIR}/answer.wav`
// Edit the paths below for your machine. Mods run sandboxed, so there is no $HOME to read.
const PROFILE = '/Users/YOU/.claude/interview-coach/profile.md'
const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const WHISPER = '/opt/homebrew/bin/whisper-cli'
const MODEL = '/Users/YOU/.whisper-models/ggml-large-v3-turbo.bin'

const TRACKS = [
  'behavioural (leadership, conflict or failure)',
  'consulting fit',
  'product management',
  'why MBA / why IIM Calcutta / career goals',
  'resume deep-dive on a past internship',
]

const FILLERS = /\b(um+|uh+|erm|basically|actually|literally|you know|i mean|sort of|kind of|like)\b/gi

const blank: Coach = {
  phase: 'idle', view: 'summary', track: '', question: '', seconds: 0, spoken: 0, idealMin: 0, idealMax: 0,
  transcript: '', words: 0, wpm: 0, fillers: 0, fillerWords: '', framework: '', parts: [], better: [],
  verdict: '', fixNext: '', error: '',
}

const coach = atom({ plugin: 'interview-coach', key: 'coach' } as const, blank)
const history = atom({ plugin: 'interview-coach', key: 'history' } as const, [])

const paceColor = (wpm: number) => (wpm > 175 ? 'red' : wpm > 155 || wpm < 110 ? 'yellow' : 'green')
const paceWord = (wpm: number) =>
  wpm > 175 ? 'too fast' : wpm > 155 ? 'a bit fast' : wpm < 110 ? 'a bit slow' : 'good pace'
const verdictColor = (v: string) => (v === 'strong' ? 'green' : v === 'weak' ? 'yellow' : 'red')
const verdictMark = (v: string) => (v === 'strong' ? '✓' : v === 'weak' ? '~' : '✗')
const secs = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}m${String(Math.round(n % 60)).padStart(2, '0')}s` : `${Math.round(n)}s`)

// "[00:00:01.120 --> 00:00:04.500]  text" lines from whisper-cli
const toSec = (t: string) => {
  const [h, m, s] = t.split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

const parseJson = (text: string): any => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const COACH_SYSTEM = `You are a sharp MBA final-placements interview coach at IIM Calcutta. You know the candidate's real background (given). Be specific and blunt, no praise padding, no em dashes anywhere.
Return ONLY a JSON object, no prose, with exactly these keys:
{
 "framework": "the best framework for this question type, e.g. STAR, CAR, Past-Present-Future, Problem-Approach-Impact",
 "idealMinSeconds": number, "idealMaxSeconds": number,   // how long a strong spoken answer to THIS question should run
 "parts": [ { "label": "framework step name", "said": "one sentence: what he actually said for this step, or 'Not covered'",
              "words": number (approx words of his answer spent on this step, 0 if missing),
              "idealShare": number (percent of ideal answer time this step deserves; all parts sum to 100),
              "verdict": "strong" | "weak" | "missing",
              "fix": "one concrete improvement for this step, max 25 words" } ],
 "verdict": "one line overall judgement, max 20 words",
 "fixNext": "the single most important change next attempt, max 20 words",
 "better": [ { "title": "a better example from HIS profile", "why": "why it fits this question better, max 20 words",
               "outline": "framework steps as 'Step: content' joined by ' | ', with real numbers from the profile, max 60 words" } ]   // exactly 2
}
Only use numbers that appear in the profile. Never invent metrics.`

export const register: Register = on => {
  // Buttons only queue a job; a worker started in session.start runs it,
  // because $ cannot be stored and a button's dispatch is short-lived.
  let isRecording = false
  let isBusy = false
  let pending: 'ask' | 'record' | null = null
  let round = 0

  on('session.start', async ($, e, next) => {
    const set = (patch: Partial<Coach>) => update($, coach, c => ({ ...c, ...patch }))
    const fail = (error: string) => set({ phase: 'error', error })

    const ask = async () => {
      const track = TRACKS[round++ % TRACKS.length]
      await set({ ...blank, phase: 'asking', track })
      const r = await $.model.complete({
        model: 'haiku',
        timeoutMs: 30000,
        effort: 'low',
        maxTokens: 120,
        prompt:
          `You interview MBA students at IIM Calcutta for final placements. Ask ONE ${track} question. ` +
          'Under 30 words. Output only the question, no preamble, no quotes, no em dashes.',
      })
      if (!r.isAnswered) return fail(`Could not get a question (${r.reason}).`)
      const question = r.text.trim()
      await set({ phase: 'ready', question })
      void $.audio.speak(question).catch(() => {})
    }

    const record = async () => {
      if (isRecording) return
      await $.process.run(['mkdir', '-p', DIR])
      isRecording = true
      await set({ phase: 'recording', seconds: 0 })

      const rec = $.process.spawn({
        argv: [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:2', '-stats_period', '0.5',
          '-f', 'avfoundation', '-i', ':0', '-ac', '1', '-ar', '16000', '-t', '300', '-f', 's16le', RAW],
      })
      let seconds = 0
      try {
        for await (const { text } of rec) {
          const m = /out_time_us=(\d+)/.exec(text)
          if (m) {
            seconds = Number(m[1]) / 1e6
            await set({ seconds })
          }
          if (!isRecording) break
        }
      } catch (err) {
        isRecording = false
        return fail(`Mic recording failed: ${String(err)}. Grant your terminal microphone access in System Settings.`)
      }
      isRecording = false
      await score(seconds)
    }

    const score = async (seconds: number) => {
      if (seconds < 3) return fail('That was under 3 seconds. Press Record and answer out loud.')
      await set({ phase: 'transcribing', seconds })

      const conv = await $.process.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', RAW, WAV])
      if (conv.exitCode !== 0) return fail(`Audio conversion failed: ${conv.stderr.slice(0, 120)}`)

      const w = await $.process.run([WHISPER, '-m', MODEL, '-f', WAV, '-np', '-l', 'en'], { timeoutMs: 180000 })
      const lines = [...w.stdout.matchAll(/\[(\d\d:\d\d:\d\d\.\d+) --> (\d\d:\d\d:\d\d\.\d+)\]\s*(.*)/g)]
      const transcript = lines.map(l => l[3]).join(' ').replace(/\s+/g, ' ').trim()
      if (w.exitCode !== 0 || transcript === '') return fail('Transcription came back empty. Speak closer to the mic.')

      // Speaking time: first word to last word, so silence before and after does not count
      const spoken = Math.max(1, toSec(lines[lines.length - 1]?.[2] ?? '0:0:0') - toSec(lines[0]?.[1] ?? '0:0:0'))
      const words = transcript.split(' ').filter(Boolean).length
      const wpm = Math.round(words / (spoken / 60))
      const found = (transcript.match(FILLERS) ?? []).map(f => f.toLowerCase())
      const tally = [...new Set(found)].map(f => `${f} x${found.filter(x => x === f).length}`).join(', ')
      await set({ phase: 'scoring', transcript, words, wpm, spoken, fillers: found.length, fillerWords: tally })

      const profile = await $.fs.read(PROFILE).catch(() => '')
      const c = await read($, coach)
      const r = await $.model.complete({
        model: 'sonnet',
        timeoutMs: 90000,
        maxTokens: 1800,
        system: COACH_SYSTEM,
        prompt: `CANDIDATE PROFILE:\n${profile}\n\nQUESTION (${c.track}): ${c.question}\n\n` +
          `TRANSCRIPT OF HIS SPOKEN ANSWER (${words} words in ${Math.round(spoken)}s, ${wpm} wpm, ${found.length} fillers):\n${transcript}`,
      })
      const j = r.isAnswered ? parseJson(r.text) : null
      if (j === null) {
        await set({ phase: 'done', verdict: r.isAnswered ? 'Coach reply was not readable; try again.' : `No feedback (${r.reason}).` })
      } else {
        const parts: Part[] = (j.parts ?? []).map((p: any) => ({
          label: String(p.label ?? ''), said: String(p.said ?? ''), fix: String(p.fix ?? ''),
          verdict: p.verdict === 'strong' || p.verdict === 'weak' ? p.verdict : 'missing',
          words: Number(p.words) || 0, idealShare: Number(p.idealShare) || 0,
        }))
        const better: Better[] = (j.better ?? []).slice(0, 2).map((b: any) => ({
          title: String(b.title ?? ''), why: String(b.why ?? ''), outline: String(b.outline ?? ''),
        }))
        await set({
          phase: 'done', framework: String(j.framework ?? ''), parts, better,
          idealMin: Number(j.idealMinSeconds) || 0, idealMax: Number(j.idealMaxSeconds) || 0,
          verdict: String(j.verdict ?? ''), fixNext: String(j.fixNext ?? ''),
        })
      }

      const past = ((await $.store.get('wpmHistory')) as number[] | undefined) ?? []
      const trend = [...past, wpm].slice(-10)
      await $.store.set('wpmHistory', trend)
      await update($, history, () => trend)

      const done = await read($, coach)
      const timing = done.idealMax > 0
        ? (spoken < done.idealMin ? `, ${Math.round(done.idealMin - spoken)} seconds short` : spoken > done.idealMax ? `, ${Math.round(spoken - done.idealMax)} seconds too long` : ', good length')
        : ''
      void $.audio.speak(`${wpm} words per minute, ${paceWord(wpm)}${timing}. ${found.length} filler words.`).catch(() => {})
    }

    $.clock.every(300, () => {
      if (isBusy || pending === null) return
      const job = pending
      pending = null
      isBusy = true
      void (job === 'ask' ? ask() : record())
        .catch(err => fail(`Something broke: ${String(err)}`))
        .finally(() => { isBusy = false })
    })

    await $.command.register({ name: 'coach', description: 'Open the spoken interview coach pane' })
    const past = ((await $.store.get('wpmHistory')) as number[] | undefined) ?? []
    await update($, history, () => past)
    await update($, coach, () => blank)
    return next(e)
  })

  on('command.run', { command: 'coach' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Interview Coach' })
    return { text: 'Interview Coach opened. Press "New question", answer out loud, then "Stop".' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await read($, coach)
    const hist = await read($, history)
    const busy = c.phase === 'asking' || c.phase === 'transcribing' || c.phase === 'scoring'
    const width = Math.max(30, (e.viewport?.columns ?? 60) - 4)
    const barW = Math.max(10, Math.min(30, width - 34))
    const show = (v: View) => update($, coach, x => ({ ...x, view: v }))

    const status =
      c.phase === 'asking' ? 'Thinking of a question...'
      : c.phase === 'recording' ? `● Recording ${Math.floor(c.seconds)}s, speak then press Stop`
      : c.phase === 'transcribing' ? `Transcribing ${Math.round(c.seconds)}s of audio locally...`
      : c.phase === 'scoring' ? 'Coach is breaking down your answer (up to 90s)...'
      : ''

    // Time bar: where his speaking time lands against the ideal window
    const scaleMax = Math.max(c.idealMax * 1.4, c.spoken * 1.1, 1)
    const pos = (s: number) => Math.min(barW - 1, Math.round((s / scaleMax) * barW))
    const timeBar = Array.from({ length: barW }, (_, i) =>
      i === pos(c.spoken) ? '●' : i >= pos(c.idealMin) && i <= pos(c.idealMax) ? '═' : '─').join('')
    const timeColor = c.idealMax === 0 ? 'white'
      : c.spoken < c.idealMin * 0.8 || c.spoken > c.idealMax * 1.2 ? 'red'
      : c.spoken < c.idealMin || c.spoken > c.idealMax ? 'yellow' : 'green'
    const idealMid = (c.idealMin + c.idealMax) / 2
    const totalWords = Math.max(1, c.parts.reduce((n, p) => n + p.words, 0))

    const tab = (v: View, label: string) => (
      <Button key={`tab-${v}`} label={c.view === v ? `▸${label}` : label} onPress={() => void show(v)} />
    )

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          {!busy && c.phase !== 'recording' && <Button key="ask" label="New question" onPress={() => { pending = 'ask' }} />}
          {(c.phase === 'ready' || c.phase === 'done' || c.phase === 'error') && c.question !== '' &&
            <Button key="rec" label="Record answer" onPress={() => { pending = 'record' }} />}
          {c.phase === 'recording' && <Button key="stop" label="Stop" onPress={() => { isRecording = false }} />}
          {(busy || c.phase === 'error') && (
            <Button key="reset" label="Reset" onPress={() => {
              pending = null
              isRecording = false
              isBusy = false
              void update($, coach, () => blank)
            }} />
          )}
        </Box>
        {status !== '' && <Text color={c.phase === 'recording' ? 'red' : 'cyan'}>{status}</Text>}
        {c.phase === 'error' && <Text color="red">{c.error}</Text>}
        {c.phase === 'idle' && <Text dimColor>Asks a placement question aloud, records your answer, times it, breaks it into a framework and suggests better examples from your own background.</Text>}

        {c.question !== '' && <Text bold>{c.question}</Text>}

        {c.wpm > 0 && (
          <Box gap={1}>
            {tab('summary', 'Summary')}
            {c.parts.length > 0 && tab('breakdown', 'Breakdown')}
            {c.better.length > 0 && tab('better', 'Better answers')}
            {tab('transcript', 'Transcript')}
          </Box>
        )}

        {c.wpm > 0 && c.view === 'summary' && (
          <Box flexDirection="column">
            <Text>
              Spoke <Text bold color={timeColor}>{secs(c.spoken)}</Text>
              {c.idealMax > 0 && <Text dimColor>  ideal {secs(c.idealMin)} to {secs(c.idealMax)}</Text>}
              {c.idealMax > 0 && c.spoken < c.idealMin && <Text color={timeColor}>  ({secs(c.idealMin - c.spoken)} short)</Text>}
              {c.idealMax > 0 && c.spoken > c.idealMax && <Text color={timeColor}>  ({secs(c.spoken - c.idealMax)} over)</Text>}
            </Text>
            {c.idealMax > 0 && <Text><Text dimColor>0 </Text><Text color={timeColor}>{timeBar}</Text><Text dimColor> ═ ideal  ● you</Text></Text>}
            <Text>
              Pace <Text bold color={paceColor(c.wpm)}>{c.wpm} wpm</Text><Text dimColor> {paceWord(c.wpm)}, aim 130 to 155</Text>
              <Text>   Fillers </Text>
              <Text bold color={c.fillers > 4 ? 'red' : c.fillers > 1 ? 'yellow' : 'green'}>{c.fillers}</Text>
              <Text dimColor>{c.fillerWords !== '' ? `  ${c.fillerWords}` : ''}</Text>
            </Text>
            {c.framework !== '' && (
              <Text>
                {c.parts.map((p, i) => (
                  <Text key={`flow-${i}`}>
                    <Text bold color={verdictColor(p.verdict)}>{verdictMark(p.verdict)} {p.label}</Text>
                    {i < c.parts.length - 1 ? <Text dimColor> ──▶ </Text> : ''}
                  </Text>
                ))}
              </Text>
            )}
            {c.verdict !== '' && <Text>{c.verdict}</Text>}
            {c.fixNext !== '' && <Text><Text bold color="cyan">Next time: </Text>{c.fixNext}</Text>}
            {hist.length > 1 && <Text dimColor>Pace trend: {hist.map((w, i) => (i === hist.length - 1 ? `[${w}]` : `${w}`)).join(' › ')}</Text>}
          </Box>
        )}

        {c.view === 'breakdown' && c.parts.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>{c.framework}: your time per step vs ideal</Text>
            <Box flexDirection="column">
              {c.parts.map((p, i) => {
                const yours = (p.words / totalWords) * c.spoken
                const ideal = (p.idealShare / 100) * idealMid
                const scale = Math.max(1, ...c.parts.map(q => Math.max((q.words / totalWords) * c.spoken, (q.idealShare / 100) * idealMid)))
                const yb = Math.round((yours / scale) * (barW - 6))
                const ib = Math.round((ideal / scale) * (barW - 6))
                return (
                  <Box key={`bar-${i}`} flexDirection="column">
                    <Text><Text bold color={verdictColor(p.verdict)}>{verdictMark(p.verdict)} {p.label}</Text></Text>
                    <Text>  you   <Text color={verdictColor(p.verdict)}>{'█'.repeat(yb) || '·'}</Text><Text dimColor> {secs(yours)}</Text></Text>
                    <Text dimColor>  ideal {'▒'.repeat(ib) || '·'} {secs(ideal)}</Text>
                  </Box>
                )
              })}
            </Box>
            {c.parts.map((p, i) => (
              <Box key={`para-${i}`} flexDirection="column">
                <Text bold color={verdictColor(p.verdict)}>{i + 1}. {p.label} ({p.verdict})</Text>
                <Text wrap="wrap"><Text dimColor>You said: </Text>{p.said}</Text>
                <Text wrap="wrap"><Text color="cyan">Fix: </Text>{p.fix}</Text>
              </Box>
            ))}
          </Box>
        )}

        {c.view === 'better' && c.better.length > 0 && (
          <Box flexDirection="column" gap={1}>
            {c.better.map((b, i) => (
              <Box key={`better-${i}`} flexDirection="column">
                <Text bold color="green">{i + 1}. {b.title}</Text>
                <Text dimColor wrap="wrap">{b.why}</Text>
                {b.outline.split('|').map((step, k) => {
                  const [head, ...rest] = step.split(':')
                  return (
                    <Text key={`step-${i}-${k}`} wrap="wrap">
                      {k === 0 ? '  ┌ ' : k === b.outline.split('|').length - 1 ? '  └▶ ' : '  ├▶ '}
                      <Text bold>{(head ?? '').trim()}</Text>{rest.length > 0 ? `: ${rest.join(':').trim()}` : ''}
                    </Text>
                  )
                })}
              </Box>
            ))}
            <Text dimColor>Examples come from profile.md in the mod folder; edit it to add stories.</Text>
          </Box>
        )}

        {c.view === 'transcript' && c.transcript !== '' && (
          <Box flexDirection="column">
            <Text dimColor>{c.words} words, {secs(c.spoken)} speaking, {secs(c.seconds)} recorded</Text>
            <Text italic wrap="wrap">"{c.transcript}"</Text>
          </Box>
        )}
      </Box>
    )
  })
}
