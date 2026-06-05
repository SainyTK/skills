# codex-computer-use

Delegate desktop GUI tasks to a Codex subprocess using Computer Use. Instead of clicking through Mac apps yourself, you describe the task in plain text and a headless `codex exec` process operates the GUI on your behalf — focusing windows, clicking buttons, scrolling, reading screen content, and writing results to a file.

Typical uses:

- Read the latest messages in LINE, Slack, or any desktop chat app
- Inspect running apps and their current state
- Smoke-test computer-use automation without writing full UI test code
- Automate repetitive Mac GUI workflows

---

## Prerequisites

### 1. ChatGPT subscription

Codex CLI requires a **ChatGPT Plus, Pro, Business, Edu, or Enterprise** plan.

### 2. Install Codex CLI

**macOS / Linux (recommended):**

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

**Homebrew:**

```bash
brew install --cask codex
```

**npm:**

```bash
npm install -g @openai/codex
```

**Windows:**

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

### 3. Sign in

```bash
codex
```

At the prompt, choose **Sign in with ChatGPT** and complete the browser OAuth flow. Your session is saved locally — you only need to do this once.

---

## Usage

Run a task:

```bash
bun skills/automation/codex-computer-use/scripts/run.ts \
  --task "Read the latest visible LINE messages. Do not reply."
```

Dry-run (builds the command without launching Codex):

```bash
bun skills/automation/codex-computer-use/scripts/run.ts \
  --task "List currently running apps." \
  --dry-run
```

Save the result to a file:

```bash
bun skills/automation/codex-computer-use/scripts/run.ts \
  --task "Read the latest visible LINE messages. Do not reply." \
  --out output/line-latest.txt
```

> **Note:** Computer Use operates the active macOS GUI — expect foreground app focus changes during real runs. Default to read-only tasks; only perform writes/sends when explicitly requested.
