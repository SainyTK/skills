---
name: read-line-messages
description: >
  Read messages from the LINE desktop app accurately by screenshotting the
  conversation and transcribing the images verbatim. Use when the user asks to
  read / check / summarize their LINE messages, or wants an exact (non-garbled)
  transcript of a LINE chat — especially Thai text where plain OCR misreads
  tone marks and substitutes plausible-but-wrong words.
---

# read-line-messages

Two-phase reader that gets **accurate** LINE message text. Plain "read the screen"
OCR garbles Thai (wrong tone marks, swapped บ/น/ช/จ, hallucinated words) and
LINE — a Qt app — exposes no accessibility text, no clipboard copy, and an
encrypted local store, so AX/clipboard extraction is a dead end. This skill instead
captures clean per-window screenshots and transcribes them with a dedicated,
verbatim-constrained vision pass.

## How it works

1. **Capture.** The `codex-computer-use` skill is used **only to drive the GUI** —
   focus LINE, open the conversation, and scroll up between frames. The actual
   screenshots are taken by **this skill's own process** with
   `screencapture -x -o -l<windowid>`, saved to `screenshots/line-01.png`,
   `line-02.png`, … (`line-01` = newest view; higher = older). The split is
   necessary because the `codex exec` seatbelt sandbox strips macOS Screen
   Recording, so `screencapture` fails inside it — but it works from this skill's
   shell. Per-window capture (`-l<id>`) works even though full-display capture is
   TCC-blocked for the terminal. Scrolling stops early (dedup by image bytes /
   `AT_TOP`) once the conversation top is reached.
2. **Transcribe (a fresh `codex exec -i …`).** The PNGs are attached to a second,
   non-interactive codex that transcribes every message verbatim and **cites each
   message back to its source screenshot filename**. It is told never to
   "correct"/normalize Thai and to mark ambiguous glyphs/URL characters as 〔?〕.

## Usage

```bash
# Default: 3 screenshots (current view + 2 scrolls up), transcript to screenshots/transcript.md
bun .agents/skills/read-line-messages/scripts/run.ts

# More history, open a specific chat first
bun .agents/skills/read-line-messages/scripts/run.ts --shots 5 --conversation "Small Sam"

# See the planned commands/prompts without running anything
bun .agents/skills/read-line-messages/scripts/run.ts --dry-run
```

Options: `-n/--shots N`, `--scroll-pages P`, `-c/--conversation <name>`,
`-o/--out <file>`, `-m/--model <model>`, `--keep` (don't wipe old shots),
`--dry-run`, `-h/--help`.

## Output

- `screenshots/line-NN.png` — the captured frames (newest = `line-01`).
- `screenshots/transcript.md` — verbatim transcript, one section per screenshot,
  plus a "Low-confidence" section for any 〔?〕 spots.

Both stay under this skill folder and are **gitignored** (`screenshots/`); they are
machine-local artifacts, not part of the system definition.

## Requirements

- LINE desktop app **running and logged in** (the script aborts if no on-screen
  LINE window is found).
- `codex` CLI on PATH (or `CODEX_BIN`), `bun`, and `python3` (used via Quartz to
  locate the LINE window id).
- The Computer Use phase brings LINE to the foreground and scrolls it; expect
  visible focus changes. It is read-only — it never sends or modifies anything.

## Safety

Read-only by design. The capture sub-agent is instructed not to send, reply, react,
delete, or change settings; the transcribe pass only reads local PNGs. Treat the
transcript as OCR output — exact where legible, with 〔?〕 marking genuine ambiguity.
