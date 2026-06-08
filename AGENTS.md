Skills are organized into category folders under `skills/`:

- `automation/` — Codex-powered task automation (computer use, image generation)
- `integrations/` — service readers and local-account integrations
- `in-progress/` — drafts not yet ready to ship
- `deprecated/` — no longer used

Every skill in `automation/` or `integrations/` must have a reference entry in the top-level `README.md` and an entry in `.claude-plugin/plugin.json`. Skills in `in-progress/` and `deprecated/` must not appear in either.

Each skill entry in the top-level `README.md` must link the skill name to its `SKILL.md`.

Each category folder has a `README.md` that lists every skill in the category with a one-line description, with the skill name linked to its `SKILL.md`.

Whenever the skill structure changes — adding, removing, or moving a skill between categories — update `skills.sh.json` to match:

- Each grouping's `skills` array lists the skill folder names (not display names) for that category.
- Only skills in `automation/` and `integrations/` appear in `skills.sh.json`. Skills in `in-progress/` and `deprecated/` must be omitted.

## Skill versioning

Every `SKILL.md` has a `version` field in its frontmatter (e.g. `version: 0.0.1`). Bump the patch version (the third number) every time any part of the skill changes — instructions, scripts, commands, config, or metadata. Use semantic versioning:

- **patch** (`0.0.x`) — any update to an existing skill (instructions, examples, fix, config tweak)
- **minor** (`0.x.0`) — new commands, new scripts, or backward-compatible capability added
- **major** (`x.0.0`) — breaking change: renamed commands, removed features, changed auth flow

Always increment the version when editing a `SKILL.md` or any file under that skill's folder.
