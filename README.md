# Claude Code mods

Thirteen mods I wrote for Claude Code in October 2026, the week mods were announced. A mod is a plugin of TypeScript hooks that runs inside Claude Code: it can draw panes and bands in the terminal, add slash commands, give Claude new tools, and block or react to tool calls. I built these to see how far the system goes, and a few of them I now use every day.

The one I use most is **interview-coach**: it asks a placement interview question aloud, records my spoken answer, transcribes it on the Mac with Whisper, and scores pace, filler words and structure against my own CV stories.

## The mods

| Mod | How you use it | What it does |
|---|---|---|
| [interview-coach](mods/interview-coach) | `/coach` | Spoken mock interview in a side pane. Asks a question aloud, records from the mic, transcribes locally (Whisper large-v3-turbo via whisper.cpp), then shows speaking time against the target, words per minute, filler words, time spent on each step of the answer framework, and two stronger example answers drawn from your profile. Keeps a WPM trend across sessions. |
| [nihongo](mods/nihongo) | `/nihongo` | Japanese tutor pane: kana drill that weights look-alike pairs and brings misses back sooner, 44 N5 word cards, and a sentence builder where Claude Haiku sets a line from the week's grammar and corrects your kana answer. A word band above the prompt shows a new word each turn. |
| [joka-pond](mods/joka-pond) | `/pond` | Animated ASCII pond that earns XP for every tool Claude uses and climbs a consulting ladder from Intern to Managing Partner. Storms when a tool fails, keeps a daily streak. |
| [aurora](mods/aurora) | `/visuals`, `/aurora` | Truecolor pixel art: an aurora band above the prompt whose colours follow the time of day, plus a gallery (plasma, ocean sunset, warp, a 4-4-6 breathing lotus). |
| [avatar](mods/avatar) | `/buddy` | A pixel companion docked beside the chat. Its mood follows Claude: thinking, happy after a reply, worried after a failure, sleepy after midnight. |
| [chart](mods/chart) | Claude calls it | Gives Claude a tool that draws bar, line, area and donut charts inline in the chat, with axes, labels and legends. |
| [heatmap](mods/heatmap) | Claude calls it | Inline truecolor heatmaps with heat, green and diverging palettes. |
| [diagram](mods/diagram) | Claude calls it | Flowcharts drawn in the terminal: coloured boxes by role, laid out top to bottom with labelled arrows. |
| [animate](mods/animate) | Claude calls it | Plays short truecolor animations (fireworks, rain, aurora and others) inside a chat row at about 15 fps. |
| [pixel](mods/pixel) | Claude calls it | Draws a pixel-art image in the chat from a JSON grid of colours. |
| [change-ledger](mods/change-ledger) | `/changes` | Pane listing every file Claude created or edited this session. |
| [em-dash-guard](mods/em-dash-guard) | automatic | Blocks any write or edit that adds an em dash, my house style for documents. |
| [hello-mod](mods/hello-mod) | `/hi` | Starter mod: an instant reply with no model call, a guard that blocks `rm -rf`, and a toast at the end of each turn. |

[statusline/statusline-command.sh](statusline/statusline-command.sh) is my status line: model, effort, context used, 5-hour and weekly usage with time left, folder and git branch, colour-coded green, yellow and red.

## Try one

```
claude --plugin-dir ./mods/chart
```

Pass `--plugin-dir` once per mod you want. `claude plugin validate ./mods/chart` checks a mod before loading it.

interview-coach needs `ffmpeg`, `whisper-cpp` (`brew install ffmpeg whisper-cpp`) and a Whisper model file. Set the paths at the top of `mods/interview-coach/hooks/register.tsx`, and copy `profile.example.md` to the profile path with your own experiences.

## What I learned building them

- The `$` context object can't be stored or passed around. Long-running work has to start from a worker in `session.start`; buttons only queue jobs for it.
- Redrawing a pane on a timer rebuilds its buttons and swallows clicks. Animations repaint pixels with `$.ui.blit` instead.
- A tool registered in `session.start` becomes callable only from the next prompt.
- Plugin tool results must be strings, so structured results go back as JSON text.
- ffmpeg's `-progress` flag must come before `-i`, or progress output never arrives.
