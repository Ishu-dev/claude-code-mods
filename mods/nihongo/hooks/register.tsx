import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Card, Mode, Tally, Ui, Word } from '../types'

const PANE = 'nihongo'
const VOICE = 'Kyoko'
const IST_MS = 19800000

const pairs = (s: string) =>
  s.split(',').map(p => {
    const [c, r] = p.trim().split(' ')
    return { c, r }
  })

const HIRA = pairs(
  'あ a,い i,う u,え e,お o,か ka,き ki,く ku,け ke,こ ko,さ sa,し shi,す su,せ se,そ so,た ta,ち chi,つ tsu,て te,と to,' +
    'な na,に ni,ぬ nu,ね ne,の no,は ha,ひ hi,ふ fu,へ he,ほ ho,ま ma,み mi,む mu,め me,も mo,や ya,ゆ yu,よ yo,' +
    'ら ra,り ri,る ru,れ re,ろ ro,わ wa,を o,ん n',
)
const KATA = pairs(
  'ア a,イ i,ウ u,エ e,オ o,カ ka,キ ki,ク ku,ケ ke,コ ko,サ sa,シ shi,ス su,セ se,ソ so,タ ta,チ chi,ツ tsu,テ te,ト to,' +
    'ナ na,ニ ni,ヌ nu,ネ ne,ノ no,ハ ha,ヒ hi,フ fu,ヘ he,ホ ho,マ ma,ミ mi,ム mu,メ me,モ mo,ヤ ya,ユ yu,ヨ yo,' +
    'ラ ra,リ ri,ル ru,レ re,ロ ro,ワ wa,ヲ o,ン n',
)
const HARD_HIRA = 'きさぬめねれわるろはほまそんあお'
const HARD_KATA = 'シツソンノメヌクワケタチテスラフレルアマ'

// From the confusion-pair table in the plan
const HOOKS: Record<string, string> = {
  シ: 'strokes come from the left and sweep up (a smile at the bottom)',
  ツ: 'strokes come from the top and sweep down (tsunami falling)',
  ソ: 'one short stroke on top, long stroke sweeps down',
  ン: 'strokes start low on the left and sweep up',
  ノ: 'one stroke',
  メ: 'two strokes crossing',
  ヌ: 'two strokes, the cross sits lower',
  ス: 'sharp corner at the top right',
  ラ: 'has the extra top stroke',
  ル: 'two strokes',
  き: 'two crossbars',
  さ: 'one crossbar',
  ぬ: 'the loop sits at the tail',
  め: 'no loop at the tail',
  ね: 'loops at the end',
  れ: 'hooks to the right',
  わ: 'curves without a hook',
  る: 'loops at the end',
  ろ: 'open at the end',
  は: 'no extra horizontal',
  ほ: 'has the extra horizontal',
  ま: 'no vertical stem on the left',
}

const ALT: Record<string, string> = { si: 'shi', ti: 'chi', tu: 'tsu', hu: 'fu', wo: 'o' }

const WORDS: Word[] = `私|わたし|I
学生|がくせい|student
先生|せんせい|teacher
友達|ともだち|friend
本|ほん|book
水|みず|water
食べます|たべます|to eat
飲みます|のみます|to drink
行きます|いきます|to go
来ます|きます|to come
見ます|みます|to see, to watch
聞きます|ききます|to listen, to ask
読みます|よみます|to read
書きます|かきます|to write
話します|はなします|to speak
学校|がっこう|school
家|うち|home
車|くるま|car
電車|でんしゃ|train
大きい|おおきい|big
小さい|ちいさい|small
新しい|あたらしい|new
古い|ふるい|old
高い|たかい|expensive, tall
安い|やすい|cheap
おいしい|おいしい|delicious
静か|しずか|quiet
きれい|きれい|pretty, clean
元気|げんき|well, healthy
好き|すき|to like
人|ひと|person
犬|いぬ|dog
猫|ねこ|cat
机|つくえ|desk
部屋|へや|room
上|うえ|above
下|した|below
中|なか|inside
隣|となり|next to
前|まえ|in front
後ろ|うしろ|behind
今日|きょう|today
明日|あした|tomorrow
毎日|まいにち|every day`
  .split('\n')
  .map(l => {
    const [jp, reading, en] = l.split('|')
    return { jp, reading, en }
  })

const GRAMMAR = [
  { from: '2026-09-07', week: 2, name: 'Copula and noun sentences', points: 'X は Y です, じゃないです, でした, じゃなかったです, か, の, これ/それ/あれ, この/その/あの, も, ね, よ, self-introduction' },
  { from: '2026-09-14', week: 3, name: 'Verbs, part 1', points: 'ます/ません/ました/ませんでした, particles を に へ で, ませんか, ましょう' },
  { from: '2026-09-21', week: 4, name: 'Adjectives', points: 'い-adjectives and な-adjectives with past and negative, とても, あまり + negative, あります vs います, うえ/した/なか/まえ/うしろ/となり' },
  { from: '2026-09-28', week: 5, name: 'Consolidation of weeks 2 to 4', points: '' },
  { from: '2026-10-19', week: 6, name: 'The て form', points: 'て form of all verb classes, てください, ています, てもいいです, てはいけません, から (because), が (but)' },
  { from: '2026-10-26', week: 7, name: 'Past tense and desire', points: 'past ました forms, たい, ほしい, に行きます, counters 人 つ 本 枚 回' },
  { from: '2026-11-02', week: 8, name: 'Plain form', points: 'plain present/past/negative of all verb classes, と思います, と言っていました' },
  { from: '2026-11-09', week: 9, name: 'Modifying nouns', points: 'relative clauses, のが好きです, ことができます, たり〜たりします' },
  { from: '2026-11-16', week: 10, name: 'Giving, receiving, obligation', points: 'あげる/くれる/もらう, なければいけません, なくてもいいです' },
  { from: '2026-11-30', week: 11, name: 'Comparison and quantity', points: 'より, のほうが, いちばん, ぐらい, だけ, しか〜ない, adverbs from adjectives' },
]

const TOPICS = ['campus', 'food', 'family', 'train and travel', 'friends', 'the weekend', 'the classroom', 'shopping', 'weather', 'a daily routine']

const isHard = (c: string) => HARD_HIRA.includes(c) || HARD_KATA.includes(c)

const weighted = (list: { card: Card; w: number }[], skip: string | undefined): Card => {
  const pool = list.filter(x => x.card.key !== skip)
  const total = pool.reduce((n, x) => n + x.w, 0)
  let roll = Math.random() * total
  for (const x of pool) {
    roll -= x.w
    if (roll <= 0) return x.card
  }
  return pool[pool.length - 1].card
}

const mastery = (t: Tally | undefined) => {
  const tot = t ? t.r + t.w : 0
  const rate = t && tot > 0 ? t.w / tot : 0.3
  return (tot < 3 ? 1.5 : 1) * (1 + 4 * rate)
}

const pickKana = (stats: Record<string, Tally>, skip: string | undefined): Card =>
  weighted(
    [...HIRA.map(k => ({ k, kata: false })), ...KATA.map(k => ({ k, kata: true }))].map(({ k, kata }) => {
      const key = `k:${k.c}`
      return {
        card: { key, front: k.c, back: k.r, speak: k.c, extra: HOOKS[k.c] ?? '' },
        w: (kata ? 1.6 : 1) * (isHard(k.c) ? 2 : 1) * mastery(stats[key]),
      }
    }),
    skip,
  )

const pickWord = (stats: Record<string, Tally>, skip: string | undefined): Card =>
  weighted(
    WORDS.map(wd => {
      const key = `w:${wd.jp}`
      return {
        card: { key, front: wd.jp, back: `${wd.reading}   ${wd.en}`, speak: wd.reading, extra: '' },
        w: mastery(stats[key]),
      }
    }),
    skip,
  )

const randomWord = (): Word => WORDS[Math.floor(Math.random() * WORDS.length)]

const dayOf = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10)
const before = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)

const streakOf = (days: string[], today: string) => {
  const seen = new Set(days)
  let cursor = seen.has(today) ? today : before(today)
  let n = 0
  while (seen.has(cursor)) {
    n += 1
    cursor = before(cursor)
  }
  return n
}

const unlocked = (today: string) => GRAMMAR.filter(g => g.from <= today)

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

const isRomaji = (s: string) => /^[\x00-\x7f]*$/.test(s)

const blank: Ui = {
  mode: 'home', card: null, n: 0, revealed: false, result: 'idle',
  feedback: '', fix: '', busy: false, right: 0, wrong: 0, error: '',
}

const ui = atom({ plugin: 'nihongo', key: 'ui' } as const, blank)
const band = atom({ plugin: 'nihongo', key: 'band' } as const, null)
const isBandOn = atom({ plugin: 'nihongo', key: 'isBandOn' } as const, true)
const stats = atom({ plugin: 'nihongo', key: 'stats' } as const, {})
const days = atom({ plugin: 'nihongo', key: 'days' } as const, [])

type Job = { kind: 'gen' } | { kind: 'grade'; answer: string } | { kind: 'speak'; text: string }

export const register: Register = on => {
  // Buttons and inputs only queue a job; a worker started in session.start runs it,
  // because $ cannot be stored and a handler's dispatch is short-lived.
  const queue: Job[] = []
  let isBusy = false

  on('session.start', async ($, e, next) => {
    const set = (patch: Partial<Ui>) => update($, ui, u => ({ ...u, ...patch }))

    const pointsFor = async () => {
      const today = dayOf(await $.clock.now())
      const open = unlocked(today)
      const current = open[open.length - 1]
      const all = open.map(g => g.points).filter(p => p !== '').join('; ')
      const focus = current && current.points !== '' ? current.points : all
      return { all, focus, name: current ? `Week ${current.week}: ${current.name}` : 'Week 2' }
    }

    const gen = async () => {
      await set({ busy: true, card: null, result: 'idle', feedback: '', fix: '', error: '' })
      const { all, focus } = await pointsFor()
      const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)]
      const r = await $.model.complete({
        model: 'haiku',
        timeoutMs: 30000,
        effort: 'low',
        maxTokens: 250,
        prompt:
          'You write translation drills for a beginner learning Japanese (JLPT N5). ' +
          `Grammar the learner has seen so far: ${all}. Drill mostly this: ${focus}. Topic: ${topic}. ` +
          'Write ONE short English sentence (max 10 words) for the learner to translate into Japanese, using only that grammar and basic N5 vocabulary. ' +
          'Return ONLY JSON: {"en":"the English sentence","target":"a natural model answer in Japanese","point":"the grammar point it drills, in a few words"}. No em dashes.',
      })
      const j = r.isAnswered ? parseJson(r.text) : null
      if (!j || typeof j.en !== 'string' || typeof j.target !== 'string') {
        return set({ busy: false, error: `Could not get a sentence (${r.isAnswered ? 'bad reply' : r.reason}). Press Start to retry.` })
      }
      await update($, ui, u => ({
        ...u, busy: false, n: u.n + 1,
        card: { key: 's', front: j.en, back: j.target, speak: j.target, extra: String(j.point ?? '') },
      }))
    }

    const grade = async (answer: string) => {
      const cur = await read($, ui)
      if (!cur.card) return
      await set({ busy: true })
      const { all } = await pointsFor()
      const r = await $.model.complete({
        model: 'haiku',
        timeoutMs: 30000,
        effort: 'low',
        maxTokens: 300,
        prompt:
          'You are a strict but kind Japanese tutor for a beginner (JLPT N5). ' +
          `Grammar seen so far: ${all}. English prompt: "${cur.card.front}". Model answer: "${cur.card.back}". Learner wrote: "${answer}". ` +
          'Judge the learner sentence. ok is true if it is grammatical and carries the meaning, even if it differs from the model answer; kana versus kanji differences are fine. ' +
          'If not ok, name the exact rule broken in under 25 words (for example: を marks the object of the verb). ' +
          'Return ONLY JSON: {"ok":true|false,"corrected":"the corrected sentence, or the learner sentence if ok","rule":"the rule broken, or one line on what was good"}. No em dashes.',
      })
      const j = r.isAnswered ? parseJson(r.text) : null
      if (!j) return set({ busy: false, error: `Could not grade that (${r.isAnswered ? 'bad reply' : r.reason}). Try again.` })
      const ok = j.ok === true
      const today = dayOf(await $.clock.now())
      await update($, stats, s => {
        const t = s['s'] ?? { r: 0, w: 0 }
        return { ...s, s: { r: t.r + (ok ? 1 : 0), w: t.w + (ok ? 0 : 1) } }
      })
      await update($, days, d => (d.includes(today) ? d : [...d, today].slice(-400)))
      await $.store.set('stats', await read($, stats))
      await $.store.set('days', await read($, days))
      await set({
        busy: false,
        result: ok ? 'right' : 'wrong',
        feedback: String(j.rule ?? ''),
        fix: String(j.corrected ?? ''),
        right: cur.right + (ok ? 1 : 0),
        wrong: cur.wrong + (ok ? 0 : 1),
      })
      void $.audio.speak(String(j.corrected ?? cur.card.back), { voice: VOICE }).catch(() => {})
    }

    $.clock.every(300, () => {
      if (isBusy || queue.length === 0) return
      const job = queue.shift() as Job
      isBusy = true
      const run =
        job.kind === 'gen' ? gen() :
        job.kind === 'grade' ? grade(job.answer) :
        $.audio.speak(job.text, { voice: VOICE }).then(() => undefined)
      void run
        .catch(err => set({ busy: false, error: `Something broke: ${String(err)}` }))
        .finally(() => { isBusy = false })
    })

    await $.command.register({ name: 'nihongo', description: 'Open the Japanese tutor: kana drill, word cards, sentence builder' })
    const savedStats = ((await $.store.get('stats')) as Record<string, Tally> | undefined) ?? {}
    const savedDays = ((await $.store.get('days')) as string[] | undefined) ?? []
    await update($, stats, () => savedStats)
    await update($, days, () => savedDays)
    await update($, ui, () => blank)
    await update($, band, () => randomWord())
    const streak = streakOf(savedDays, dayOf(await $.clock.now()))
    $.ui.status(`日本語 ${streak}d`)
    return next(e)
  })

  on('command.run', { command: 'nihongo' }, async $ => {
    await $.ui.open({ id: PANE, title: '日本語' })
    return { text: 'Nihongo opened. Pick kana, words or sentences.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, band, () => randomWord())
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const word = await read($, band)
    if (e.props.hasSurvey || word === null || !(await read($, isBandOn))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="cyan">日本語 </Text>
        <Text bold>{word.jp}</Text>
        <Text dimColor>{word.jp === word.reading ? '' : `  ${word.reading}`}  {word.en}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const u = await read($, ui)
    const st = await read($, stats)
    const dd = await read($, days)
    const today = dayOf(await $.clock.now())
    const open = unlocked(today)
    const current = open[open.length - 1]
    const streak = streakOf(dd, today)
    const total = u.right + u.wrong

    const set = (patch: Partial<Ui>) => update($, ui, x => ({ ...x, ...patch }))

    const record = async (key: string, ok: boolean) => {
      await update($, stats, s => {
        const t = s[key] ?? { r: 0, w: 0 }
        return { ...s, [key]: { r: t.r + (ok ? 1 : 0), w: t.w + (ok ? 0 : 1) } }
      })
      await update($, days, d => (d.includes(today) ? d : [...d, today].slice(-400)))
      await $.store.set('stats', await read($, stats))
      await $.store.set('days', await read($, days))
    }

    const draw = async (mode: Mode, patch: Partial<Ui> = {}) => {
      const s = await read($, stats)
      const skip = (await read($, ui)).card?.key
      const card = mode === 'kana' ? pickKana(s, skip) : pickWord(s, skip)
      await update($, ui, x => ({ ...x, ...patch, mode, card, n: x.n + 1, revealed: false, result: 'idle', fix: '', error: '' }))
    }

    const go = (mode: Mode) => {
      if (mode === 'sentence') {
        queue.push({ kind: 'gen' })
        return set({ ...blank, mode, busy: true })
      }
      return draw(mode, { ...blank, mode, feedback: '' })
    }

    const answerKana = async (value: string) => {
      const card = u.card
      const given = ALT[value.trim().toLowerCase()] ?? value.trim().toLowerCase()
      if (!card || given === '') return
      const ok = given === card.back
      await record(card.key, ok)
      if (ok) {
        await draw('kana', { right: u.right + 1, feedback: `✓ ${card.front} = ${card.back}` })
      } else {
        await set({
          result: 'wrong', revealed: true, wrong: u.wrong + 1,
          feedback: `✗ ${card.front} is "${card.back}", you wrote "${given}"`,
          fix: card.extra,
        })
      }
    }

    const answerSentence = async (value: string) => {
      const text = value.trim()
      if (text === '') return
      if (isRomaji(text)) {
        await set({ feedback: 'No romaji. Type it in kana (switch the Mac to Japanese input with ctrl+space, then try again).' })
        return
      }
      queue.push({ kind: 'grade', answer: text })
    }

    const mark = async (ok: boolean) => {
      if (!u.card) return
      await record(u.card.key, ok)
      await draw('words', {
        right: u.right + (ok ? 1 : 0), wrong: u.wrong + (ok ? 0 : 1),
        feedback: `${ok ? '✓' : '✗'} ${u.card.front}  ${u.card.back}`,
      })
    }

    const listen = (text: string) => queue.push({ kind: 'speak', text })

    // Weakest characters by miss rate, at least 2 attempts
    const weak = Object.entries(st)
      .filter(([k, t]) => k.startsWith('k:') && t.r + t.w >= 2 && t.w > 0)
      .sort((a, b) => b[1].w / (b[1].r + b[1].w) - a[1].w / (a[1].r + a[1].w))
      .slice(0, 8)
      .map(([k]) => k.slice(2))
      .join(' ')

    const header = (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan" bold>日本語</Text>
          <Text dimColor>  streak {streak}d</Text>
          {current ? <Text dimColor>  |  Week {current.week}: {current.name}</Text> : null}
        </Text>
        {u.mode !== 'home' && <Text dimColor>This session: {u.right} right, {u.wrong} missed{total > 0 ? ` (${Math.round((u.right / total) * 100)}%)` : ''}</Text>}
      </Box>
    )

    if (u.mode === 'home') {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box gap={1}>
            <Button key="kana" hotkey="1" label="Kana drill" onPress={() => void go('kana')} />
            <Button key="words" hotkey="2" label="Word cards" onPress={() => void go('words')} />
            <Button key="sent" hotkey="3" label="Sentence builder" onPress={() => void go('sentence')} />
          </Box>
          <Text dimColor>Kana: type the romaji reading. Katakana and look-alike pairs come up more often, and anything you miss comes back sooner.</Text>
          <Text dimColor>Sentences: translate an English line into kana or kanji. Romaji is refused, as the plan says.</Text>
          {weak !== '' && <Text color="yellow">Weakest kana: {weak}</Text>}
          <Button key="band" label={`Word band above the prompt: ${(await read($, isBandOn)) ? 'on' : 'off'}`} onPress={() => void update($, isBandOn, v => !v)} />
        </Box>
      )
    }

    const back = <Button key="back" hotkey="b" label="Back" onPress={() => void set({ ...blank })} />
    const flash = u.feedback !== '' && u.result !== 'wrong' && u.mode !== 'sentence'
      ? <Text color={u.feedback.startsWith('✓') ? 'green' : 'red'}>{u.feedback}</Text>
      : null

    if (u.mode === 'kana' && u.card) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {flash}
          <Text bold color="cyan">   {u.card.front}</Text>
          {u.result === 'wrong' ? (
            <Box flexDirection="column">
              <Text color="red">{u.feedback}</Text>
              {u.fix !== '' && <Text dimColor>Hook: {u.fix}</Text>}
              <Box gap={1}>
                <Button key="next" hotkey="n" variant="primary" label="Next" onPress={() => void draw('kana')} />
                <Button key="hear" hotkey="l" label="Listen" onPress={() => listen(u.card!.speak)} />
                {back}
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Input key={`kana-${u.n}`} autoFocus label="Reading: " placeholder="e.g. ka" onSubmit={v => void answerKana(v)} />
              <Box gap={1}>
                <Button key="hear" hotkey="l" label="Listen" onPress={() => listen(u.card!.speak)} />
                <Button key="skip" hotkey="s" label="Skip" onPress={() => void draw('kana')} />
                {back}
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    if (u.mode === 'words' && u.card) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {flash}
          <Text bold color="cyan">   {u.card.front}</Text>
          {u.revealed ? <Text>   {u.card.back}</Text> : <Text dimColor>   What does it mean, and how is it read?</Text>}
          <Box gap={1}>
            {!u.revealed && <Button key="show" hotkey="s" variant="primary" label="Show answer" onPress={() => void set({ revealed: true })} />}
            {u.revealed && <Button key="got" hotkey="g" variant="primary" label="Got it" onPress={() => void mark(true)} />}
            {u.revealed && <Button key="miss" hotkey="m" label="Missed" onPress={() => void mark(false)} />}
            <Button key="hear" hotkey="l" label="Listen" onPress={() => listen(u.card!.speak)} />
            {back}
          </Box>
        </Box>
      )
    }

    if (u.mode === 'sentence') {
      const card = u.card
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {u.busy && <Text dimColor>Thinking...</Text>}
          {u.error !== '' && <Text color="red">{u.error}</Text>}
          {card && (
            <Box flexDirection="column">
              <Text bold color="cyan">{card.front}</Text>
              {card.extra !== '' && <Text dimColor>Drills: {card.extra}</Text>}
            </Box>
          )}
          {card && u.result === 'idle' && !u.busy && (
            <Box flexDirection="column">
              {u.feedback !== '' && <Text color="yellow">{u.feedback}</Text>}
              <Input key={`sent-${u.n}`} autoFocus label="日本語: " placeholder="type in kana or kanji" onSubmit={v => void answerSentence(v)} />
            </Box>
          )}
          {card && u.result !== 'idle' && (
            <Box flexDirection="column">
              <Text color={u.result === 'right' ? 'green' : 'red'}>{u.result === 'right' ? '✓ Good' : '✗ Not quite'}   {u.fix}</Text>
              <Text>{u.feedback}</Text>
              <Text dimColor>Model answer: {card.back}</Text>
            </Box>
          )}
          <Box gap={1}>
            {(card === null && !u.busy) && <Button key="start" hotkey="s" variant="primary" label="Start" onPress={() => void go('sentence')} />}
            {card && u.result !== 'idle' && !u.busy && <Button key="next" hotkey="n" variant="primary" label="Next" onPress={() => void go('sentence')} />}
            {card && !u.busy && <Button key="hear" hotkey="l" label="Listen" onPress={() => listen(card.back)} />}
            {card && u.result === 'idle' && !u.busy && <Button key="skip" hotkey="k" label="Skip" onPress={() => void go('sentence')} />}
            {back}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {back}
      </Box>
    )
  })
}
