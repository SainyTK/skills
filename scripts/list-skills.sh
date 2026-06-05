#!/usr/bin/env bash
# List all skills and their descriptions.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find "$REPO/skills" -mindepth 2 -maxdepth 2 -name "SKILL.md" | sort | while read -r skill_md; do
  skill_name="$(basename "$(dirname "$skill_md")")"
  category="$(basename "$(dirname "$(dirname "$skill_md")")")"
  desc="$(grep -m1 '^description:' "$skill_md" | sed 's/^description: *//' | tr -d '>' | xargs || true)"
  printf "%-12s  %-30s  %s\n" "[$category]" "$skill_name" "$desc"
done
