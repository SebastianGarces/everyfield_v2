#!/usr/bin/env bash
#
# THE FENCE IS ONLY WORTH ITS GREEN IF IT BITES (#654).
#
# `src/lib/picture-key-boundary.test.ts` passes on a clean tree, which is also
# what it would do if its patterns matched nothing at all — the failure mode
# #617 hit twice, where a guard shipped broken and stayed green. So this puts
# each leak BACK, one at a time, and asserts the fence goes red for it.
#
# Four leaks, chosen to be the four channels rather than four spellings:
#
#   1. the person key as a PROP on a client component  (RSC payload)
#   2. the person key on a Server Action's RETURN path (response payload)
#   3. the avatar key in a client module               (#617's first channel)
#   4. the avatar key via a VARIABLE in avatar.ts      (#617's second channel,
#      the shape that typechecks and that both earlier scans walked past)
#
# Plus a fifth that is not a leak channel but the POSITIVE half of the file:
# the shared control stops declaring the route prop every surface reads.
#
# Every edit is reverted from a byte-for-byte copy taken before it, and the
# trap restores on any exit — Ctrl-C included. The last step re-runs the suite
# clean, so a failure to restore cannot be mistaken for a pass.
#
# Rerun it: ./scripts/prove-picture-key-fence.sh
set -uo pipefail

cd "$(dirname "$0")/.."

SUITE="src/lib/picture-key-boundary.test.ts"
BACKUPS=()

restore() {
  for entry in "${BACKUPS[@]:-}"; do
    [ -n "$entry" ] || continue
    mv "$entry" "${entry%.fence-bak}"
  done
  BACKUPS=()
}
trap restore EXIT INT TERM

# `leak <file> <anchor-line> <line-to-insert-after-it>` — puts one leak into a
# real file, by matching a line that is actually there rather than by line
# number, so a reformat cannot silently make this script patch nothing.
leak() {
  local file="$1" anchor="$2" inserted="$3"

  cp "$file" "$file.fence-bak"
  BACKUPS+=("$file.fence-bak")

  python3 - "$file" "$anchor" "$inserted" <<'PY'
import sys
path, anchor, inserted = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().split("\n")
hits = [i for i, line in enumerate(lines) if anchor in line]
if len(hits) != 1:
    sys.exit(f"anchor {anchor!r} matched {len(hits)} lines in {path} — this script is stale")
lines.insert(hits[0] + 1, inserted)
open(path, "w").write("\n".join(lines))
PY
}

# `rename <file> <exact-line> <replacement>` — the other shape of edit. `leak`
# adds a line; this replaces one, which is what deleting a declaration looks
# like. Same backup discipline, same staleness check.
rename() {
  local file="$1" from="$2" to="$3"

  cp "$file" "$file.fence-bak"
  BACKUPS+=("$file.fence-bak")

  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if s.count(frm) != 1:
    sys.exit(f"{frm!r} appears {s.count(frm)} times in {path} — this script is stale")
open(path, "w").write(s.replace(frm, to))
PY
}

expect_red() {
  local label="$1"

  if npx tsx --test "$SUITE" >/dev/null 2>&1; then
    echo "FAIL — the fence stayed GREEN with this leak in the tree: $label"
    exit 1
  fi

  echo "==> red, as it must be: $label"
  restore
}

echo "==> 1/5  the person key as a prop on a client component"
leak "src/components/people/person-photo-field.tsx" \
  "interface PersonPhotoFieldProps {" \
  "  photoUrl: string | null;"
expect_red "person-photo-field.tsx takes photoUrl"

echo "==> 2/5  the person key on a Server Action's return path"
leak "src/app/(dashboard)/people/actions.ts" \
  "export async function uploadPersonPhotoAction(" \
  "  const leaked = { photoUrl: \"people/church/person/x.png\" };"
expect_red "actions.ts parks the key in a variable on the way out"

echo "==> 3/5  the avatar key in a client module"
leak "src/components/settings/avatar-field.tsx" \
  "type AvatarFieldProps = {" \
  "  avatarKey: string | null;"
expect_red "avatar-field.tsx takes avatarKey"

echo "==> 4/5  the avatar key via a variable, outside the effects object"
leak "src/lib/auth/avatar.ts" \
  "export type AvatarOutcome" \
  "const leaked = { ok: true, avatarKey: key };"
expect_red "avatar.ts names the key outside LIVE_AVATAR_EFFECTS"

echo "==> 5/5  the shared control stops declaring a route prop"
# NOT a leak channel — this proves the POSITIVE half of the file, the row that
# asserts each surface holds a resolved route. It shipped matching a bare /src/,
# which any `src=` attribute in the file satisfied, so deleting the prop left it
# green. A guard that cannot go red is the failure this file exists to catch,
# one level up.
rename "src/components/picture-field.tsx" \
  "  src: string | undefined;" \
  "  srcRenamedAway: string | undefined;"
expect_red "picture-field.tsx stops declaring its route prop"

echo "==> restoring and re-running clean"
restore

if ! npx tsx --test "$SUITE"; then
  echo "FAIL — the suite is not green on the restored tree; check git status"
  exit 1
fi

echo
echo "PASS — red for all four leak channels AND for a missing route prop; green without them."
