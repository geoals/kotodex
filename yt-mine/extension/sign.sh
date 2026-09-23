#!/usr/bin/env bash
# Sign the extension as unlisted on addons.mozilla.org and write the .xpi to
# target/extension/. Firefox release installs only signed extensions for good.
#
# Needs KOTODEX_AMO_API_KEY and KOTODEX_AMO_API_SECRET in the repo's .env —
# the "JWT issuer" and "JWT secret" from
# https://addons.mozilla.org/developers/addon/api/key/
#
# AMO refuses a version it has already signed, so the patch version is bumped
# first; commit manifest.json afterwards.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
[[ -f "$root/.env" ]] && set -a && . "$root/.env" && set +a
: "${KOTODEX_AMO_API_KEY:?set KOTODEX_AMO_API_KEY in .env}"
: "${KOTODEX_AMO_API_SECRET:?set KOTODEX_AMO_API_SECRET in .env}"

version="$(python3 - "$here/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
m = json.load(open(path))
major, minor, patch = m["version"].split(".")
m["version"] = f"{major}.{minor}.{int(patch) + 1}"
open(path, "w").write(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
print(m["version"])
PY
)"
echo "signing $version"

npx --yes web-ext sign \
  --channel unlisted \
  --approval-timeout 3600000 \
  --source-dir "$here" \
  --ignore-files sign.sh README.md \
  --artifacts-dir "$root/target/extension" \
  --api-key "$KOTODEX_AMO_API_KEY" \
  --api-secret "$KOTODEX_AMO_API_SECRET"

echo "Install: open $root/target/extension/ in Firefox (drag the .xpi onto a tab)."
