#!/usr/bin/env bash
# One-shot: create the callcap/desktop GitHub repo, push this folder,
# and cut the first release so installers start building.
#
# Prereqs (one-time):
#   1. Install GitHub CLI:  https://cli.github.com  (brew install gh)
#   2. Run:  gh auth login          (pick GitHub.com, HTTPS, browser)
#
# Then from inside desktop-recorder/:
#   ./bootstrap.sh                  # uses default repo callcap/desktop, tag v0.1.0
#   ./bootstrap.sh myorg/desktop v0.1.1

set -euo pipefail

REPO="${1:-callcap/desktop}"
TAG="${2:-v0.1.0}"

command -v gh >/dev/null || { echo "Install GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login"; exit 1; }

WORK="$(mktemp -d)"
echo "Staging in $WORK"
cp -R . "$WORK/"
cd "$WORK"

# Fresh git history — this folder becomes the repo root.
rm -rf .git
git init -q -b main
git add .
git -c user.email=bootstrap@callcap -c user.name=Callcap commit -q -m "Initial commit"

# Create the repo (public — required so Releases downloads are unauthenticated).
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "Repo $REPO already exists — pushing to it."
  git remote add origin "https://github.com/$REPO.git"
  git push -u origin main --force
else
  gh repo create "$REPO" --public --source=. --remote=origin --push
fi

# Tag → triggers the release workflow → installers appear in Releases.
git tag "$TAG"
git push origin "$TAG"

echo
echo "Done. Watch the build:"
echo "  https://github.com/$REPO/actions"
echo "Installers will appear at:"
echo "  https://github.com/$REPO/releases/tag/$TAG"