#!/usr/bin/env bash
# List all skills and their descriptions.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

read_description() {
  awk '
    /^description:[[:space:]]*[>|][+-]?[[:space:]]*$/ {
      in_description = 1
      next
    }
    /^description:[[:space:]]*/ {
      sub(/^description:[[:space:]]*/, "")
      print
      exit
    }
    in_description && /^[[:space:]]+/ {
      sub(/^[[:space:]]+/, "")
      if (length($0) > 0) {
        if (description != "") {
          description = description " "
        }
        description = description $0
      }
      next
    }
    in_description {
      print description
      description_printed = 1
      exit
    }
    END {
      if (in_description && !description_printed) {
        print description
      }
    }
  ' "$1"
}

find "$REPO/skills" -mindepth 3 -maxdepth 3 -name "SKILL.md" | sort | while read -r skill_md; do
  skill_name="$(basename "$(dirname "$skill_md")")"
  category="$(basename "$(dirname "$(dirname "$skill_md")")")"
  desc="$(read_description "$skill_md")"
  printf "%-12s  %-30s  %s\n" "[$category]" "$skill_name" "$desc"
done
