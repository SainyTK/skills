---
name: codex-computer-use
version: 0.0.1
description: >
  Run Codex non-interactively to complete desktop GUI tasks with Computer Use.
  Use when the user asks to delegate a Mac app/browser UI task to a Codex
  subprocess, run computer-use through codex exec, inspect local apps, read
  messages, click/type/scroll in GUI apps, or smoke-test computer-use automation.
---

# codex-computer-use

Use this skill when a task should be completed by a separate `codex exec`
subprocess that can operate local Mac apps through Computer Use.

The implementation lives under `scripts/`:

- `scripts/run.ts` - standalone Bun runner around `codex exec`

## Runner

Basic use:

```bash
bun .agents/skills/codex-computer-use/scripts/run.ts \
  --task "Read the latest visible LINE messages. Do not reply."
```

Smoke-test command construction without launching Codex:

```bash
bun .agents/skills/codex-computer-use/scripts/run.ts \
  --task "List currently running apps using Computer Use." \
  --dry-run
```

Capture the final sub-agent answer:

```bash
bun .agents/skills/codex-computer-use/scripts/run.ts \
  --task "Read the latest visible LINE messages. Do not reply." \
  --out output/codex-computer-use/line-latest.txt
```

## Behavior

The runner:

1. Finds `codex` from `CODEX_BIN` or `PATH`.
2. Runs `codex exec` in non-interactive mode.
3. Uses `--cd`, `--sandbox workspace-write`, `--skip-git-repo-check`, and
   `--ephemeral` by default.
4. Writes the final sub-agent message when `--out` is provided.
5. Injects instructions to use the `computer-use` skill and avoid side effects.

Computer Use currently operates the active macOS GUI. There is no confirmed
headless/background Computer Use mode exposed by `codex exec`; expect foreground
app focus changes when a real GUI task runs.

## Safety

Default to read/inspect-only tasks unless the user explicitly asks for UI changes.
Do not send messages, submit forms, delete data, change settings, purchase, upload,
or transmit sensitive data unless the user clearly requested that exact action and
the Computer Use confirmation policy allows it.

For real runs, tell the user the task may focus or manipulate local apps. For
non-disruptive validation, prefer `--dry-run`.
