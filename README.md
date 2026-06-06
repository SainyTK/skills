<div align="center">

<img src="assets/banner.png" alt="skills banner" width="360" />

# Sainy Skills

My personal Claude Code agent skills — collected in one place.

</div>

---

## Quickstart

Install via [skills.sh](https://skills.sh):

```bash
npx skills@latest add SainyTK/sainy-skills
```

Or clone and link manually:

```bash
git clone https://github.com/SainyTK/sainy-skills ~/Documents/projects/personal/sainy-skills/skills
bash ~/Documents/projects/personal/sainy-skills/skills/scripts/link-skills.sh
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
- **[read-line-messages](./skills/integrations/read-line-messages/SKILL.md)** — Read LINE desktop chats from screenshots with accurate transcription.
- **[read-trello-tasks](./skills/integrations/read-trello-tasks/SKILL.md)** — Read Trello boards, lists, cards, and checklist tasks.
