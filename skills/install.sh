#!/usr/bin/env bash
# Install n8nctl Claude Code skills to ~/.claude/skills/
#
# Usage:
#   cd path/to/n8nctl
#   ./skills/install.sh            # install all skills
#   ./skills/install.sh <name>     # install one skill
#   FORCE=1 ./skills/install.sh    # overwrite existing without prompt
#
# Only works for Claude Code — the "skills" loaded via ~/.claude/skills/ directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

# Detect Windows (Git Bash) and adjust path
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    TARGET="${CLAUDE_SKILLS_DIR:-$USERPROFILE/.claude/skills}"
    ;;
esac

mkdir -p "$TARGET"

install_one() {
  local name="$1"
  local src="$SCRIPT_DIR/$name"
  local dst="$TARGET/$name"

  if [ ! -d "$src" ]; then
    echo "✗ skill not found: $name" >&2
    return 1
  fi

  if [ -d "$dst" ] && [ "${FORCE:-0}" != "1" ]; then
    printf "? overwrite existing '%s'? (y/N) " "$name"
    read -r REPLY
    case "$REPLY" in
      [yY]*) ;;
      *) echo "  skipped $name"; return 0 ;;
    esac
  fi

  mkdir -p "$dst"
  cp -f "$src/SKILL.md" "$dst/SKILL.md"
  echo "✓ installed $name → $dst"
}

if [ $# -gt 0 ]; then
  for name in "$@"; do install_one "$name"; done
  exit 0
fi

# Install all
for dir in "$SCRIPT_DIR"/*/; do
  name="$(basename "$dir")"
  install_one "$name"
done

echo
echo "All skills installed to: $TARGET"
echo "Claude Code picks them up automatically on next session."
