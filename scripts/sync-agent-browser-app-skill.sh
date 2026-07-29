#!/usr/bin/env bash
# Sync one integration skill from agent-browser-app-cli.
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly TARGET="${1:-}"
readonly VERSION_BUMP="${2:-patch}"

download_dir=""
staging_dir=""
backup_dir=""
destination=""
write_started=0

cleanup() {
  local exit_status=$?

  if [[ "$write_started" -eq 1 && -n "$backup_dir" && -d "$backup_dir" ]]; then
    if [[ -f "$backup_dir/SKILL.md" ]]; then
      cp "$backup_dir/SKILL.md" "$destination/SKILL.md"
    else
      rm -f "$destination/SKILL.md"
    fi

    if [[ -f "$backup_dir/agents/openai.yaml" ]]; then
      mkdir -p "$destination/agents"
      cp "$backup_dir/agents/openai.yaml" "$destination/agents/openai.yaml"
    else
      rm -f "$destination/agents/openai.yaml"
    fi
  fi

  if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
    rm -rf -- "$backup_dir"
  fi

  if [[ -n "$staging_dir" && -d "$staging_dir" ]]; then
    rm -rf -- "$staging_dir"
  fi

  if [[ -n "$download_dir" && -d "$download_dir" ]]; then
    rm -rf -- "$download_dir"
  fi

  exit "$exit_status"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

bump_version() {
  local version="$1"
  local bump="$2"
  local major
  local minor
  local patch

  IFS=. read -r major minor patch <<< "$version"

  case "$bump" in
    patch)
      patch=$((patch + 1))
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    *)
      fail "version bump must be patch, minor, or major"
      ;;
  esac

  printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

read_version() {
  local skill_file="$1"

  awk '
    NR == 1 && $0 == "---" {
      in_frontmatter = 1
      next
    }
    in_frontmatter && $0 == "---" {
      exit
    }
    in_frontmatter && /^version:[[:space:]]*/ {
      version_count += 1
      sub(/^version:[[:space:]]*/, "")
      sub(/[[:space:]]*$/, "")
      version = $0
    }
    END {
      if (version_count == 1) {
        print version
      }
    }
  ' "$skill_file"
}

rewrite_skill_frontmatter() {
  local version="$1"
  local skill_file="$staging_dir/SKILL.md"
  local rewritten_file="$skill_file.rewritten"

  awk -v source_name="$source_name" -v target_name="$TARGET" -v version="$version" '
    BEGIN {
      delimiter_count = 0
      in_frontmatter = 0
      name_count = 0
    }
    $0 == "---" {
      delimiter_count += 1
      if (delimiter_count == 1) {
        in_frontmatter = 1
      } else if (delimiter_count == 2) {
        in_frontmatter = 0
      }
      print
      next
    }
    in_frontmatter && $0 == "name: " source_name {
      print "name: " target_name
      print "version: " version
      name_count += 1
      next
    }
    in_frontmatter && /^version:[[:space:]]*/ {
      next
    }
    {
      print
    }
    END {
      if (delimiter_count < 2 || name_count != 1) {
        exit 65
      }
    }
  ' "$skill_file" > "$rewritten_file" ||
    fail "downloaded SKILL.md must contain exactly one 'name: $source_name' field"

  mv "$rewritten_file" "$skill_file"
}

set_staged_version() {
  local version="$1"
  local skill_file="$staging_dir/SKILL.md"
  local rewritten_file="$skill_file.rewritten"

  awk -v version="$version" '
    BEGIN {
      delimiter_count = 0
      in_frontmatter = 0
      version_count = 0
    }
    $0 == "---" {
      delimiter_count += 1
      if (delimiter_count == 1) {
        in_frontmatter = 1
      } else if (delimiter_count == 2) {
        in_frontmatter = 0
      }
      print
      next
    }
    in_frontmatter && /^version:[[:space:]]*/ {
      print "version: " version
      version_count += 1
      next
    }
    {
      print
    }
    END {
      if (delimiter_count < 2 || version_count != 1) {
        exit 65
      }
    }
  ' "$skill_file" > "$rewritten_file" ||
    fail "staged SKILL.md must contain exactly one version field"

  mv "$rewritten_file" "$skill_file"
}

rewrite_agent_metadata() {
  local agent_file="$staging_dir/agents/openai.yaml"
  local rewritten_file="$agent_file.rewritten"

  awk -v source_token="\$${source_name}" -v target_token="\$${TARGET}" '
    {
      line = $0
      while ((token_position = index(line, source_token)) != 0) {
        line = substr(line, 1, token_position - 1) target_token \
          substr(line, token_position + length(source_token))
        replacement_count += 1
      }
      print line
    }
    END {
      if (replacement_count != 1) {
        exit 65
      }
    }
  ' "$agent_file" > "$rewritten_file" ||
    fail "downloaded agents/openai.yaml must contain exactly one '\$$source_name' token"

  mv "$rewritten_file" "$agent_file"
}

trap cleanup EXIT

case "$TARGET" in
  notebooklm)
    readonly source_name="aba-gemini-notebook"
    ;;
  x)
    readonly source_name="aba-x"
    ;;
  reddit)
    readonly source_name="aba-reddit"
    ;;
  *)
    fail "target must be notebooklm, x, or reddit"
    ;;
esac

case "$VERSION_BUMP" in
  patch | minor | major) ;;
  *) fail "version bump must be patch, minor, or major" ;;
esac

command -v npx >/dev/null 2>&1 || fail "npx is required"

destination="$REPO_ROOT/skills/integrations/$TARGET"
[[ ! -L "$destination" ]] || fail "destination must not be a symbolic link"

current_version="0.0.0"
destination_exists=0
if [[ -d "$destination" ]]; then
  destination_exists=1
  [[ -f "$destination/SKILL.md" ]] || fail "destination is missing SKILL.md: $destination"
  current_version="$(read_version "$destination/SKILL.md")"
  [[ "$current_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    fail "destination SKILL.md must contain exactly one semantic version"
elif [[ -e "$destination" ]]; then
  fail "destination is not a directory: $destination"
fi

download_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-browser-app-skills.XXXXXX")"
staging_dir="$(mktemp -d "$REPO_ROOT/skills/integrations/.$TARGET-sync.XXXXXX")"
backup_dir="$(mktemp -d "$REPO_ROOT/skills/integrations/.$TARGET-backup.XXXXXX")"

(
  cd "$download_dir"
  npx skills add sainytk/agent-browser-app-cli -a claude-code --yes
)

readonly source_dir="$download_dir/.claude/skills/$source_name"
[[ -f "$source_dir/SKILL.md" ]] || fail "downloaded $source_name skill was not found"

source_symlink="$(find "$source_dir" -type l -print -quit)"
[[ -z "$source_symlink" ]] || fail "downloaded skill contains a symbolic link: $source_symlink"

source_files="$(cd "$source_dir" && find . -type f -print | LC_ALL=C sort)"
expected_files=$'./SKILL.md\n./agents/openai.yaml'
[[ "$source_files" == "$expected_files" ]] ||
  fail "downloaded skill file set changed; review it before updating the sync script"

cp -R "$source_dir/." "$staging_dir/"
rewrite_skill_frontmatter "$current_version"
rewrite_agent_metadata

if [[ "$destination_exists" -eq 1 ]] &&
  cmp -s "$destination/SKILL.md" "$staging_dir/SKILL.md" &&
  [[ -f "$destination/agents/openai.yaml" ]] &&
  cmp -s "$destination/agents/openai.yaml" "$staging_dir/agents/openai.yaml"; then
  printf '%s is already synchronized at version %s\n' "$TARGET" "$current_version"
  exit 0
fi

if [[ "$destination_exists" -eq 0 ]]; then
  next_version="0.0.1"
else
  next_version="$(bump_version "$current_version" "$VERSION_BUMP")"
fi
set_staged_version "$next_version"

mkdir -p "$destination/agents"
if [[ -f "$destination/SKILL.md" ]]; then
  cp "$destination/SKILL.md" "$backup_dir/SKILL.md"
fi
if [[ -f "$destination/agents/openai.yaml" ]]; then
  mkdir -p "$backup_dir/agents"
  cp "$destination/agents/openai.yaml" "$backup_dir/agents/openai.yaml"
fi

write_started=1
mv "$staging_dir/SKILL.md" "$destination/SKILL.md"
mv "$staging_dir/agents/openai.yaml" "$destination/agents/openai.yaml"
write_started=0

rm -rf -- "$backup_dir"
backup_dir=""

printf 'synchronized %s from %s: %s -> %s\n' \
  "$TARGET" "$source_name" "$current_version" "$next_version"
