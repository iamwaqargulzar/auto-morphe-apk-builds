#!/usr/bin/env bash
# Gets a Google Play AAS token via browser sign-in, tests it, and stores it
# (with the email) as repo secrets. The token is never printed.
# Usage: scripts/setup-play-token.sh [email]   (run inside your clone)
set -uo pipefail
REPO=${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
GOOPDL=goopdl@1.2.2

email=${1:-}
[ -n "$email" ] || read -r -p 'Google account email (the dedicated account): ' email
echo "A browser window will open: sign in to that account there."

# Wide COLUMNS stops goopdl's output from wrapping the token across lines.
out=$(COLUMNS=4000 uvx "$GOOPDL" aastoken "$email" --browser)
token=$(printf '%s' "$out" | tr -d '\r\n' | grep -oE 'aas_et/[A-Za-z0-9._~+/=-]+' | head -1)
unset out
if [ -z "$token" ]; then
  echo "No aas_et/ token found in goopdl output. Nothing was saved."
  exit 1
fi
echo "Got a token (${#token} characters). Testing it against Google Play..."

if ! GOOPDL_ACCOUNT_EMAIL="$email" GOOPDL_AAS_TOKEN="$token" uvx "$GOOPDL" info com.google.android.youtube; then
  echo "Test failed. Nothing was saved."
  exit 1
fi

printf '%s' "$email" | gh secret set GOOPDL_ACCOUNT_EMAIL -R "$REPO"
printf '%s' "$token" | gh secret set GOOPDL_AAS_TOKEN -R "$REPO"
unset token
echo "Saved GOOPDL_ACCOUNT_EMAIL and GOOPDL_AAS_TOKEN to $REPO. Done."
