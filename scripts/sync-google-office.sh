#!/usr/bin/env bash
# Sync the google-office skill from the goog skill published by goog-cli.
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DESTINATION="$REPO_ROOT/skills/integrations/google-office"
readonly VERSION_BUMP="${1:-patch}"

download_dir=""
staging_dir=""
backup_dir=""

cleanup() {
  local exit_status=$?

  if [[ -n "$backup_dir" && -e "$backup_dir" ]]; then
    if [[ ! -e "$DESTINATION" ]]; then
      mv "$backup_dir" "$DESTINATION"
    else
      rm -rf "$backup_dir"
    fi
  fi

  if [[ -n "$staging_dir" && -e "$staging_dir" ]]; then
    rm -rf "$staging_dir"
  fi

  if [[ -n "$download_dir" && -e "$download_dir" ]]; then
    rm -rf "$download_dir"
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

rewrite_skill_frontmatter() {
  local version="$1"
  local skill_file="$staging_dir/SKILL.md"
  local rewritten_file="$skill_file.rewritten"

  awk -v version="$version" '
    BEGIN {
      name_count = 0
      delimiter_count = 0
      in_frontmatter = 0
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
    in_frontmatter && /^name:[[:space:]]*goog[[:space:]]*$/ {
      print "name: google-office"
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
    fail "downloaded SKILL.md must contain exactly one 'name: goog' field"

  mv "$rewritten_file" "$skill_file"
}

set_staged_version() {
  local version="$1"
  local skill_file="$staging_dir/SKILL.md"
  local rewritten_file="$skill_file.rewritten"

  awk -v version="$version" '
    BEGIN {
      version_count = 0
      delimiter_count = 0
      in_frontmatter = 0
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

  [[ -f "$agent_file" ]] || return 0

  awk '
    {
      replacement_count += gsub(/\$goog/, "$google-office")
      print
    }
    END {
      if (replacement_count != 1) {
        exit 65
      }
    }
  ' "$agent_file" > "$rewritten_file" ||
    fail "downloaded agents/openai.yaml must contain exactly one '\$goog' token"

  mv "$rewritten_file" "$agent_file"
}

trap cleanup EXIT

command -v npx >/dev/null 2>&1 || fail "npx is required"
case "$VERSION_BUMP" in
  patch | minor | major) ;;
  *) fail "version bump must be patch, minor, or major" ;;
esac
[[ -d "$DESTINATION" ]] || fail "destination does not exist: $DESTINATION"
[[ ! -L "$DESTINATION" ]] || fail "destination must not be a symbolic link"

current_version="$(
  awk '
    NR == 1 && $0 == "---" {
      in_frontmatter = 1
      next
    }
    in_frontmatter && $0 == "---" {
      exit
    }
    in_frontmatter && /^version:[[:space:]]*/ {
      sub(/^version:[[:space:]]*/, "")
      sub(/[[:space:]]*$/, "")
      print
    }
  ' "$DESTINATION/SKILL.md"
)"
[[ "$current_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  fail "destination SKILL.md must contain one semantic version"

download_dir="$(mktemp -d "${TMPDIR:-/tmp}/google-office-download.XXXXXX")"
staging_dir="$(mktemp -d "$REPO_ROOT/skills/integrations/.google-office-sync.XXXXXX")"

(
  cd "$download_dir"
  npx skills add sainytk/goog-cli -s goog -a claude-code
)

readonly SOURCE="$download_dir/.claude/skills/goog"
[[ -f "$SOURCE/SKILL.md" ]] || fail "downloaded goog skill was not found"

source_symlink="$(find "$SOURCE" -type l -print -quit)"
[[ -z "$source_symlink" ]] || fail "downloaded skill contains a symbolic link: $source_symlink"

cp -R "$SOURCE/." "$staging_dir/"
rewrite_skill_frontmatter "$current_version"
rewrite_agent_metadata

if diff -qr "$DESTINATION" "$staging_dir" >/dev/null; then
  printf 'google-office is already synchronized at version %s\n' "$current_version"
  exit 0
fi

next_version="$(bump_version "$current_version" "$VERSION_BUMP")"
set_staged_version "$next_version"

backup_dir="$REPO_ROOT/skills/integrations/.google-office-backup.$$"
[[ ! -e "$backup_dir" ]] || fail "backup path already exists: $backup_dir"

mv "$DESTINATION" "$backup_dir"
mv "$staging_dir" "$DESTINATION"
staging_dir=""
rm -rf "$backup_dir"
backup_dir=""

printf 'synchronized google-office from goog-cli: %s -> %s\n' "$current_version" "$next_version"
