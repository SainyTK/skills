---
name: codex-imagegen
description: >
  Generate raster images with the codex_imagegen tool. Use whenever the user asks
  to create, generate, render, draw, or make a raster image, wallpaper, PNG/JPG/WebP,
  transparent image, favicon, app icon, toolbar icon, icon set, or sprite sheet.
---

# codex-imagegen

Use this skill for **raster image generation** requests. Do not use it for SVG, vector-only,
or code-native assets unless the user explicitly wants a raster export.

The extracted extension implementation is kept with this skill under `scripts/` for
reference and future edits:

- `scripts/index.ts` — tool registration/background task orchestration
- `scripts/generate.ts` — standalone CLI runner/smoke test for these scripts
- `scripts/codex-exec.ts` — Codex backend command construction
- `scripts/icon.ts` — icon batch detection, prompt rules, slicing script
- `scripts/transparent.ts` — transparent-background detection/conversion script
- `scripts/prompts/` — prompt snippets/instructions
- `scripts/utils.ts` — path, slug, MIME, shell helpers

## Standalone script smoke test

You can run the extracted implementation without loading the pi extension:

```bash
bun .agents/skills/codex-imagegen/scripts/generate.ts \
  --prompt "pixel-art cat on a blue cushion, no text" \
  --out output/imagegen/codex-imagegen-skill-smoke-test.png \
  --size 1024x1024 \
  --quality draft \
  --force
```

For icons:

```bash
bun .agents/skills/codex-imagegen/scripts/generate.ts \
  --prompt "toolbar icon set, flat style" \
  --icon "save icon" \
  --icon "search icon" \
  --out output/imagegen/toolbar-icons.png \
  --force
```

## Primary rule

Always use the `codex_imagegen` tool when the user asks for image generation or image
creation, even if they do not mention the tool by name.

`codex_imagegen` starts a background task and returns immediately. After calling it:

1. Tell the user the background task id.
2. Tell the user the expected output path.
3. Tell the user the log path if returned.
4. Do **not** wait for completion unless the user asks you to inspect progress.

## Tool parameters

Use:

- `prompt`: detailed visual prompt. Include subject, style, constraints, composition,
  background, colors, mood, and any exact text.
- `out`: output path. Prefer workspace-local paths under `output/imagegen/`.
- `size`: requested size/aspect, e.g. `1024x1024`, `2048x1152`, `wallpaper landscape`.
- `quality`: `draft`, `low`, `medium`, or `high`; default is `high`.
- `force`: set `true` only when overwriting an existing file is intended.
- `transparent`: set `true` for transparent-background requests.
- `icons`: array of icon prompts for icon batches, max 16.

## Transparent images

When the user asks for transparency, alpha, no background, or a transparent PNG:

- Set `transparent=true`.
- The backend first renders on a flat solid green background, exactly `#008000`.
- It then converts that green background to transparency and removes the temporary
  green image.
- The prompt must avoid white/off-white/checkerboard backgrounds, shadows, gradients,
  or texture in areas meant to be transparent.

## Icons and icon sets

When the user asks for icons, favicons, app icons, toolbar icons, an icon set, or a
sprite sheet:

- Prefer the `icons` parameter with one prompt per icon.
- Batch up to 16 icons per `codex_imagegen` call.
- Icon generation automatically uses transparent output.
- The backend generates one `1024x1024` PNG sprite sheet, then slices icon outputs into
  individual `64x64` transparent PNG files.
- Report both the grid output path and the generated icon output directory/files from
  the tool result.

Icon prompt requirements used by the backend:

- One icon per grid slot, row-major from top-left.
- Identical padding/scale across icons.
- Crisp/readable at `64x64`.
- No labels, captions, slot numbers, borders, grid lines, or extra decorative marks.
- Keep artwork fully inside its slot; no overlap.
- Leave unused slots empty background only.

## Prompt construction checklist

For any generated image, make the prompt explicit:

- subject and key objects
- style/medium (photo, illustration, pixel art, 3D, flat vector-like raster, etc.)
- composition/camera/lighting
- color palette and mood
- background requirements
- size/aspect
- exact text, if any, quoted verbatim
- negative constraints (no watermark, no extra text, no border, etc.)

## If the tool is unavailable

Do not fake a generated image with a placeholder unless the user asks for a placeholder.
Say the image-generation tool is unavailable in this harness/session and ask how they
want to proceed.
