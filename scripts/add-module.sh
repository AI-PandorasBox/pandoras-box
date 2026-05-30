#!/usr/bin/env bash
# add-module.sh -- scaffold a new Pandora's Box module from MODULE-SPEC.md.
#
# Usage:
#   bash scripts/add-module.sh <name> [--kind service|config|skill-pack] [--port N] [--desc "..."]
#
# Creates modules/<name>/ pre-filled (module.json, README.md, install.sh, and
# runtime/ + a plist template for service modules). Edit, then run:
#   node scripts/validate-modules.mjs
set -euo pipefail

NAME="${1:-}"; shift || true
KIND="config"; PORT=""; DESC=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind) KIND="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --desc) DESC="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$NAME" || ! "$NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Usage: add-module.sh <lower-kebab-name> [--kind service|config|skill-pack] [--port N] [--desc \"...\"]"
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$REPO/modules/$NAME"
[[ -e "$DIR" ]] && { echo "modules/$NAME already exists"; exit 1; }
mkdir -p "$DIR"
[[ -z "$DESC" ]] && DESC="TODO: one-line description of $NAME"

# module.json
{
  echo "{"
  echo "  \"name\": \"$NAME\","
  echo "  \"version\": \"0.1.0\","
  echo "  \"description\": \"$DESC\","
  echo "  \"kind\": \"$KIND\","
  if [[ "$KIND" == "service" ]]; then
    echo "  \"ports\": [${PORT:-0}],"
    echo "  \"service_user\": \"pbox-$NAME\","
    echo "  \"launchdaemon_label\": \"\${PREFIX}.$NAME\","
  fi
  echo "  \"requires\": [],"
  echo "  \"uninstall\": \"uninstall.sh\","
  echo "  \"author\": \"TODO\""
  echo "}"
} > "$DIR/module.json"

# README
cat > "$DIR/README.md" <<EOF
# $NAME

$DESC

## What it needs
- TODO: prerequisites, third-party accounts, costs.

## Install
\`\`\`
bash modules/$NAME/install.sh
\`\`\`
EOF

# install.sh
cat > "$DIR/install.sh" <<'EOF'
#!/usr/bin/env bash
# Idempotent installer. Reads INSTALL_PATH / LAUNCHDAEMON_PREFIX from theme.conf/env.
set -euo pipefail
NAME="__NAME__"
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
# TODO: implement install steps. Service modules: render the plist template,
# plutil -lint it, load it, then curl the port and assert a response.
echo "[$NAME] PASS"
EOF
sed -i '' "s/__NAME__/$NAME/" "$DIR/install.sh" 2>/dev/null || sed -i "s/__NAME__/$NAME/" "$DIR/install.sh"
chmod +x "$DIR/install.sh"

# uninstall.sh
cat > "$DIR/uninstall.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
# TODO: stop + unload the daemon, remove installed files for $NAME.
echo "[$NAME] uninstalled"
EOF
chmod +x "$DIR/uninstall.sh"

if [[ "$KIND" == "service" ]]; then
  mkdir -p "$DIR/runtime"
  cat > "$DIR/runtime/$NAME.mjs" <<EOF
#!/usr/bin/env node
// $NAME service. Localhost-only by default.
import http from 'node:http'
const PORT = parseInt(process.env.${NAME//-/_}_PORT || '${PORT:-8490}', 10)
const BIND = process.env.${NAME//-/_}_BIND || '127.0.0.1'
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}))})
  .listen(PORT, BIND, ()=>console.log('[$NAME] listening on http://'+BIND+':'+PORT))
EOF
  cat > "$DIR/runtime/com.pandoras-box.$NAME.plist.template" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>__PREFIX__.$NAME</string>
  <key>ProgramArguments</key><array><string>__NODE__</string><string>__INSTALL_PATH__/$NAME/runtime/$NAME.mjs</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>UserName</key><string>pbox-$NAME</string>
</dict></plist>
EOF
fi

echo "Created modules/$NAME ($KIND)."
echo "Next: edit the files, then run: node scripts/validate-modules.mjs"
