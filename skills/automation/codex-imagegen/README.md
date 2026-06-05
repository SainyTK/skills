# codex-imagegen

Generate raster images by describing them in plain text. The skill routes requests to the `codex_imagegen` tool, which runs as a background task and writes the result to disk. Supports standard images, transparent-background PNGs, app icons, toolbar icon sets, and sprite sheets.

Typical uses:

- Wallpapers and hero images in any aspect ratio
- App icons, favicons, and toolbar icon sets (auto-sliced to 64×64)
- Transparent-background assets (chroma-key pipeline, no manual masking)
- Rapid visual prototyping — generate several style variations from one prompt

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

Generate an image:

```bash
bun skills/automation/codex-imagegen/scripts/generate.ts \
  --prompt "pixel-art cat on a blue cushion, no text" \
  --out output/imagegen/cat.png \
  --size 1024x1024 \
  --quality high
```

Generate an icon set:

```bash
bun skills/automation/codex-imagegen/scripts/generate.ts \
  --prompt "toolbar icon set, flat style" \
  --icon "save icon" \
  --icon "search icon" \
  --icon "settings icon" \
  --out output/imagegen/toolbar-icons.png
```

Generate a transparent-background asset:

```bash
bun skills/automation/codex-imagegen/scripts/generate.ts \
  --prompt "minimal logo mark, geometric, no background" \
  --out output/imagegen/logo.png \
  --transparent
```

### Options

| Flag | Description |
|------|-------------|
| `--prompt` | Visual description of the image |
| `--out` | Output path (`.png` / `.jpg` / `.webp`) |
| `--size` | Dimensions or aspect, e.g. `1024x1024`, `2048x1152`, `wallpaper landscape` |
| `--quality` | `draft` · `low` · `medium` · `high` (default: `high`) |
| `--transparent` | Render with a transparent background |
| `--icon` | Icon prompt (repeatable, up to 16); triggers sprite-sheet + slice pipeline |
| `--force` | Overwrite an existing output file |

> **Note:** `codex_imagegen` starts a background task and returns immediately. The tool prints the task ID and expected output path — the file appears on disk once the task completes.
