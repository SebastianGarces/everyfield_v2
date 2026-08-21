#!/usr/bin/env bash
# `role` is retired vocabulary for what an account may do (CONTEXT.md: "role" →
# seat; `users.role` was dropped in migration 0051, and account-entities.test.ts
# guards the register action against the word). #496's union is exactly "what an
# account may do", so it may not be called a role. `invitedAs` completes the
# sentence the copy table drives: "invited as an Admin", "invited as a Coach".
#
# Word-boundary anchored and property-qualified, so JSX `role="status"` and every
# ministry-team role are untouched. Rerunnable: no new name contains an old one.
set -euo pipefail
cd "$(dirname "$0")/.."

FILES=$(git ls-files 'src/*.ts' 'src/*.tsx')

for r in \
  'InvitedRoleKey:InvitedAsKey' \
  'InvitedRole:InvitedAs' \
  'invitedRoleKey:invitedAsKey' \
  'INVITED_ROLE_COPY:INVITED_AS_COPY' \
  'invitedRoleWithArticle:invitedAsWithArticle' \
  'roleCopy:invitedAsCopy' \
; do
  # shellcheck disable=SC2086
  perl -pi -e "s/\\b${r%%:*}\\b/${r##*:}/g" $FILES
done

# The PROPERTY. Qualified on each side so `role=` (ARIA) and a bare word in prose
# cannot match: `x.role` reads, `role:` declarations/literals, `role,` and
# `role,`-shaped destructuring in the files that carry the union.
CARRIERS="src/lib/invitations/seat-copy.ts src/lib/invitations/seat.ts src/lib/invitations/seat-email.ts src/lib/invitations/coach.ts src/lib/email/templates/seat-invitation.tsx src/app/(auth)/register/actions.ts src/app/(auth)/register/account-entities.ts src/app/(auth)/register/page.tsx src/app/(auth)/register/register-form.tsx src/lib/invitations/seat.test.ts src/lib/invitations/seat-invitations-live.test.ts"

for f in $CARRIERS; do
  # NO BARE-WORD RULE. The first draft had `s/\brole\b(?=\s*[,)])/invitedAs/g`
  # for parameter references, and it rewrote PROSE inside a string literal —
  # the coach email shipped "coaching is a reading invitedAs" until the diff was
  # read. Every rewrite below is anchored on punctuation that only appears in
  # code, so a sentence cannot match one; the handful of bare references were
  # finished by hand.
  perl -pi -e 's/\.role\b/.invitedAs/g;         # reads
                s/\brole: /invitedAs: /g;       # object literals + type members
                s/^(\s*)role,$/$1invitedAs,/gm; # shorthand + destructuring
                s/\(role:/\(invitedAs:/g;' "$f"
done
