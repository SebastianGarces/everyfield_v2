#!/bin/bash
# SessionStart hook: regenerate ops/principles.md from the 21 engineering
# principles so the CLAUDE.md @-import loads them in full. (Hook stdout is
# capped at 10,000 chars, so the document cannot travel through the hook
# itself — the import is the loader, this script is the generator.)
# Source of truth: .agents/skills/principle-*/SKILL.md (verbatim copies from
# github.com/cursor/plugins pstack, MIT). This script strips frontmatter and
# emits each description line plus body. Grouped order below; any principle
# directory not in the list is appended so a new copy is never silently dropped.

cd "$(dirname "$0")/.." || exit 0
DIR=.agents/skills

ORDER=(
  # core
  principle-laziness-protocol
  principle-foundational-thinking
  principle-redesign-from-first-principles
  principle-subtract-before-you-add
  principle-minimize-reader-load
  principle-outcome-oriented-execution
  principle-experience-first
  principle-exhaust-the-design-space
  principle-build-the-lever
  # architecture
  principle-model-the-domain
  principle-boundary-discipline
  principle-type-system-discipline
  principle-make-operations-idempotent
  principle-migrate-callers-then-delete-legacy-apis
  principle-separate-before-serializing-shared-state
  # verification
  principle-prove-it-works
  principle-fix-root-causes
  principle-sequence-verifiable-units
  # delegation
  principle-guard-the-context-window
  principle-never-block-on-the-human
  # meta
  principle-encode-lessons-in-structure
)

for d in "$DIR"/principle-*/; do
  name=$(basename "$d")
  found=0
  for o in "${ORDER[@]}"; do [ "$o" = "$name" ] && found=1 && break; done
  [ "$found" = 0 ] && ORDER+=("$name")
done

OUT=ops/principles.md
{
cat <<'EOF'
# Engineering principles

These principles govern every session in this repo. They are the guidance; the
process is yours to choose. Decide for yourself, keep moving, and verify against
the real artifact. When a principle shapes a decision, follow it as written.
The process itself: ops/process.md.

EOF

for name in "${ORDER[@]}"; do
  f="$DIR/$name/SKILL.md"
  [ -f "$f" ] || continue
  awk '
    NR==1 && $0=="---" { fm=1; next }
    fm==1 {
      if ($0=="---") { fm=2; next }
      if ($0 ~ /^description:/) {
        desc=$0; sub(/^description:[ ]*"?/,"",desc); sub(/"$/,"",desc)
      }
      next
    }
    fm==2 && body==0 && $0 ~ /^# / { body=1; print; if (desc!="") print "*" desc "*"; next }
    fm==2 { print }
  ' "$f"
  echo
done
} > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

echo "Engineering principles: regenerated $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes). The CLAUDE.md import @ops/principles.md loads them in full."
