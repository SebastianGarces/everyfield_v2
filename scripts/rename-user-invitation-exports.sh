#!/usr/bin/env bash
# ============================================================================
# `src/lib/invitations/seat.ts` is the logic layer for `user_invitations`, a
# table whose `kind` column has always had TWO values (`seat`, `coach`). Every
# export was named for the only kind that had a caller. #496 gives the second
# kind its caller, so the names move first, on their own, with no behaviour
# change — read the diff and every hunk is one identifier.
#
# Rerunnable: the new names contain no old name, so a second run is a no-op.
# Word boundaries keep `createSeatInvitationAs` from eating the SERVER ACTION
# `createSeatInvitationAction`, which stays seat-specific.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

RENAMES=(
  "newSeatInvitationToken:newUserInvitationToken"
  "hashSeatInvitationToken:hashUserInvitationToken"
  "SEAT_INVITE_RATE_LIMITED_MESSAGE:USER_INVITE_RATE_LIMITED_MESSAGE"
  "SEAT_INVITE_DUPLICATE_MESSAGE:USER_INVITE_DUPLICATE_MESSAGE"
  "seatInvitesFromChurchToAddressQuery:invitesFromChurchToAddressQuery"
  "CreatedSeatInvitation:CreatedUserInvitation"
  "createSeatInvitationAs:createUserInvitationAs"
  "listSeatInvitationsFor:listUserInvitationsFor"
  "revokeSeatInvitationAs:revokeUserInvitationAs"
  "resendSeatInvitationEmailAs:resendUserInvitationEmailAs"
  "SeatRegistrationInvitation:UserRegistrationInvitation"
  "describeSeatInvitationForRegistration:describeUserInvitationForRegistration"
  "seatInvitationActedOnAtRegistration:userInvitationActedOnAtRegistration"
  "claimSeatInvitationStatement:claimUserInvitationStatement"
  "expireLapsedSeatInvitations:expireLapsedUserInvitations"
)

FILES=$(git ls-files 'src/*.ts' 'src/*.tsx' 'scripts/*.ts')

for rename in "${RENAMES[@]}"; do
  old="${rename%%:*}"
  new="${rename##*:}"
  # shellcheck disable=SC2086
  perl -pi -e "s/\\b${old}\\b/${new}/g" $FILES
done

echo "renamed ${#RENAMES[@]} identifiers"
git diff --stat
