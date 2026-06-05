#!/usr/bin/env bash
# Link skills into .claude/skills/ for Claude Code.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${HOME}/.claude/skills"
mkdir -p "$TARGET"

find "$REPO/skills" -mindepth 2 -maxdepth 2 -name "SKILL.md" | while read -r skill_md; do
  skill_dir="$(dirname "$skill_md")"
  skill_name="$(basename "$skill_dir")"
  link="$TARGET/$skill_name"
  if [ -e "$link" ] || [ -L "$link" ]; then
    echo "skip (exists): $skill_name"
  else
    ln -s "$skill_dir" "$link"
    echo "linked: $skill_name -> $link"
  fi
done
