<div align="center">

<img src="assets/banner.png" alt="skills banner" width="360" />

</div>

# Agent Ultimate Skills

[![skills.sh](https://skills.sh/b/sainytk/skills)](https://skills.sh/sainytk/skills)

Equip ultimate skills to any of your AI agents.

---

## Quickstart

Install via [skills.sh](https://skills.sh):

**Claude Code**
```bash
npx skills@latest add SainyTK/skills -a claude-code
```

**Codex**
```bash
npx skills@latest add SainyTK/skills -a codex
```

## Reference

### Automation

Skills for delegating tasks to Codex subprocesses — computer use, image generation.

- **[agent-browser-core](./skills/automation/agent-browser-core/SKILL.md)** — Browser automation workflow for navigating pages, clicking, filling forms, screenshots, video capture, and authenticated browser profiles.
- **[codex-computer-use](./skills/automation/codex-computer-use/SKILL.md)** — Run Codex non-interactively to complete desktop GUI tasks with Computer Use. Drive Mac apps, click/type/scroll, read messages, smoke-test automation.
- **[codex-imagegen](./skills/automation/codex-imagegen/SKILL.md)** — Generate raster images with the `codex_imagegen` tool. Handles wallpapers, PNG/JPG/WebP, transparent images, favicons, app icons, icon sets, and sprite sheets.

### Integrations

Skills for reading and working with external services through local account setup.

- **[google-office](./skills/integrations/google-office/SKILL.md)** — Read and edit Google Drive, Docs, and Sheets via local OAuth.
- **[notebooklm](./skills/integrations/notebooklm/SKILL.md)** — Query Google NotebookLM notebooks with source-grounded answers.
- **[read-gmail](./skills/integrations/read-gmail/SKILL.md)** — Read and search Gmail messages for one or more Google accounts via local OAuth.
- **[read-line-messages](./skills/integrations/read-line-messages/SKILL.md)** — Read LINE desktop chats from screenshots with accurate transcription.
- **[read-trello-tasks](./skills/integrations/read-trello-tasks/SKILL.md)** — Read Trello boards, lists, cards, and checklist tasks.

---

## Community Skills

Skills from other repos that are worth following:

- **[grill-me](https://github.com/mattpocock/skills)** (mattpocock/skills) — Interview the user relentlessly about a plan or design until reaching shared understanding.
- **[caveman](https://github.com/juliusbrussee/caveman)** — Make agent talk like caveman — cuts ~75% of output tokens while keeping full technical accuracy.
- **[unleak](https://github.com/SainyTK/unleak)** — Local database access guardrails for AI agents — control column-by-column what the agent can see, mask personal data, and reduce sensitive data leakage.
