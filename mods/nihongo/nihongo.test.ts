import { expect, mock, test } from 'claude-code/testing'

const world = (on: any) => {
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async () => ({ value: { command: 'nihongo' } }))
  on('ui.status', async () => ({ value: undefined }))
  on('audio.speak', async () => ({ value: { via: 'system' } }))
  on('model.complete', async () => ({
    value: {
      isAnswered: true,
      text: '{"en":"I am a student.","target":"わたしはがくせいです。","point":"X は Y です"}',
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  }))
}

const pane: any = {
  title: '日本語', isFocused: true, bodyColumns: 80, placement: 'inline',
  scroll: { offset: 0, max: 0 },
}

test('kana drill: a wrong answer shows the correct reading and a Next button', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  world(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
  const ui = await $.ui.mount({ plugin: 'nihongo', surface: 'terminal', component: 'Pane', requestId: 'nihongo', props: pane })
  expect(await ui.find({ key: 'kana' })).toBeDefined()
  await ui.press({ key: 'kana' })
  await ui.input({ key: 'kana-1', text: 'zzz' })
  const shown = await ui.find({ type: 'Text', text: '✗' })
  expect(shown).toBeDefined()
  expect(await ui.find({ key: 'next' })).toBeDefined()
})

test('sentence builder asks the model for a sentence and shows it is thinking', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  world(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
  const ui = await $.ui.mount({ plugin: 'nihongo', surface: 'terminal', component: 'Pane', requestId: 'nihongo', props: pane })
  await ui.press({ key: 'sent' })
  expect(await ui.find({ type: 'Text', text: 'Thinking' })).toBeDefined()
})
