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

Skills for delegating tasks to Codex subprocesses - computer use, image generation.

- **[agent-browser-core](./skills/automation/agent-browser-core/SKILL.md)** - Browser automation workflow for navigating pages, clicking, filling forms, screenshots, video capture, and authenticated browser profiles.
- **[codex-computer-use](./skills/automation/codex-computer-use/SKILL.md)** - Run Codex non-interactively to complete desktop GUI tasks with Computer Use. Drive Mac apps, click/type/scroll, read messages, smoke-test automation.
- **[codex-imagegen](./skills/automation/codex-imagegen/SKILL.md)** - Generate raster images with the `codex_imagegen` tool. Handles wallpapers, PNG/JPG/WebP, transparent images, favicons, app icons, icon sets, and sprite sheets.

### Integrations

Skills for reading and working with external services through local account setup.

- **[google-cloud](./skills/integrations/google-cloud/SKILL.md)** - Inspect Google Cloud BigQuery and Cloud Logging through local `gcloud` and `bq` credentials.
- **[google-office](./skills/integrations/google-office/SKILL.md)** - Operate Google Workspace through the `goog` CLI via local OAuth.
- **[notebooklm](./skills/integrations/notebooklm/SKILL.md)** - Operate Gemini Notebook and NotebookLM through the authenticated ABA CLI.
- **[notion](./skills/integrations/notion/SKILL.md)** - Read, search, create, and update Notion pages, blocks, databases, and data source rows.
- **[read-line-messages](./skills/integrations/read-line-messages/SKILL.md)** - Read LINE desktop chats from screenshots with accurate transcription.
- **[read-trello-tasks](./skills/integrations/read-trello-tasks/SKILL.md)** - Read Trello boards, lists, cards, and checklist tasks.
- **[reddit](./skills/integrations/reddit/SKILL.md)** - Read authenticated Reddit feeds and public profiles through the ABA CLI.
- **[slackcli](./skills/integrations/slackcli/SKILL.md)** - Read and write Slack messages, channels, DMs, threads, canvases, and reactions via the local `slackcli` CLI.
- **[x](./skills/integrations/x/SKILL.md)** - Read authenticated X feeds and public profiles through the ABA CLI.

---

## Community Skills

Skills from other repos that are worth following:

- **[grill-me](https://github.com/mattpocock/skills)** (mattpocock/skills) - Interview the user relentlessly about a plan or design until reaching shared understanding.
- **[caveman](https://github.com/juliusbrussee/caveman)** - Make agent talk like caveman - cuts ~75% of output tokens while keeping full technical accuracy.
- **[unleak](https://github.com/SainyTK/unleak)** - Local database access guardrails for AI agents - control column-by-column what the agent can see, mask personal data, and reduce sensitive data leakage.
