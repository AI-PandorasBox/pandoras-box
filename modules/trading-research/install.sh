#!/usr/bin/env bash
# install.sh -- trading-research module installer
# DEMO-ONLY trading-signals research module. Reads IG demo-account positions
# and computes deterministic indicators for display. Places no orders, ever.
set -euo pipefail

MODULE_NAME="trading-research"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

# Support both PBOX_DRY_RUN_ACTIVE (parent-set, canonical) and PBOX_DRY_RUN
# (user-set on bare invocations). Either is sufficient for no-op mode.
if [[ "${PBOX_DRY_RUN:-0}" == "1" ]]; then
  PBOX_DRY_RUN_ACTIVE=1
fi
DRY_RUN="${PBOX_DRY_RUN_ACTIVE:-0}"

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
STORE_DIR="$TARGET_DIR/store"
PUBLIC_SRC="$MODULE_SRC_DIR/public"
PUBLIC_DST="$TARGET_DIR/public"
RUNTIME_SCRIPT="pbox-trading-research.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.trading-research"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"
TR_PORT="${TRADING_RESEARCH_PORT:-8490}"
TR_BIND="127.0.0.1"

echo ""
echo "  trading-research -- DEMO ONLY. NOT FINANCIAL ADVICE."
echo "  This module reads positions from your IG DEMO account and shows"
echo "  deterministic indicators (50/200 minute-bar MA crossover) for"
echo "  educational research only. It does not place orders."
echo ""

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js 22+ not on PATH (brew install node)"
NODE_BIN=$(command -v node)
NODE_MAJOR=$("$NODE_BIN" -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  fail "Node.js 22+ required (found $($NODE_BIN -v))"
fi
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing at $MODULE_SRC_DIR"
[[ -f "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" ]] || fail "Runtime script missing"
ok "Node.js $($NODE_BIN -v) at $NODE_BIN"

# Static analysis: ensure the demo-only gate string is present. If a future
# refactor removes it, this install must refuse rather than silently degrade.
grep -q "IG_LIVE === 'true'" "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" || fail "demo-only gate missing from runtime"
grep -q "demo-api.ig.com" "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" || fail "demo IG base URL missing from runtime"
if grep -nE "(POST|PUT|DELETE)\s+/(otc|positions|orders|workingorders)" "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" >/dev/null; then
  fail "runtime contains mutating IG endpoint references -- demo-only module rejects this"
fi
ok "Demo-only static gate present"

step 2 "Staging runtime"
if [[ "$DRY_RUN" == "1" ]]; then
  ok "(dry-run) skipping copy of runtime to $TARGET_DIR"
else
  sudo mkdir -p "$TARGET_DIR" "$STORE_DIR" "$PUBLIC_DST"
  sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
  sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
  sudo cp "$PUBLIC_SRC/index.html" "$PUBLIC_SRC/app.js" "$PUBLIC_SRC/style.css" "$PUBLIC_DST/"
  sudo chmod 644 "$PUBLIC_DST/"*
  ok "Runtime + public/ staged"
fi

step 3 "Writing .env, watchlist + collecting IG demo credentials"
TR_ENV="$TARGET_DIR/.env"
WATCHLIST="$STORE_DIR/watchlist.json"

if [[ "$DRY_RUN" == "1" ]]; then
  ok "(dry-run) skipping .env + watchlist creation; no live login attempted"
else
  if [[ -f "$TR_ENV" ]]; then
    ok ".env already present -- preserving operator overrides"
  else
    # Read credentials interactively. We never echo IG_PASSWORD.
    # We also never attempt an IG login here - the deamon does that at runtime.
    read -rp "  IG demo username: " IG_USERNAME
    read -rsp "  IG demo password (hidden): " IG_PASSWORD; echo ""
    read -rp "  IG demo API key: " IG_API_KEY
    sudo bash -c "cat > '$TR_ENV'" <<ENVEOF
# trading-research -- DEMO ONLY. NOT FINANCIAL ADVICE.
TRADING_RESEARCH_PORT=$TR_PORT
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
IG_USERNAME=$IG_USERNAME
IG_PASSWORD=$IG_PASSWORD
IG_API_KEY=$IG_API_KEY
# IG_LIVE intentionally unset. Setting IG_LIVE=true causes the daemon to refuse to start.
ENVEOF
    sudo chmod 600 "$TR_ENV"
    ok "Wrote $TR_ENV (chmod 600)"
  fi

  if [[ ! -f "$WATCHLIST" ]]; then
    sudo bash -c "cat > '$WATCHLIST'" <<WEOF
{
  "_comment": "Operator-edited. List IG epics to compute 50/200 MA crossovers for. DEMO data only.",
  "epics": []
}
WEOF
    sudo chmod 644 "$WATCHLIST"
    ok "Default watchlist created at $WATCHLIST"
  fi
fi

step 4 "Rendering + installing LaunchDaemon plist"
SERVICE_USER="${TRADING_RESEARCH_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/com.pandoras-box.trading-research.plist.template"
[[ -f "$PLIST_TMPL" ]] || fail "plist template missing at $PLIST_TMPL"

RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
    -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
    -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
    -e "s|{{LOG_PREFIX}}|${LOG_PREFIX}|g" \
    -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
    "$PLIST_TMPL" > "$RENDERED"

plutil -lint "$RENDERED" >/dev/null || { rm -f "$RENDERED"; fail "rendered plist invalid"; }

if [[ "$DRY_RUN" == "1" ]]; then
  rm -f "$RENDERED"
  ok "(dry-run) plist validated but not installed; launchctl load skipped"
  echo ""
  echo "[$MODULE_NAME] PASS (dry-run; no system changes made)"
  exit 0
fi

sudo mkdir -p "$PLIST_DIR"
sudo cp "$RENDERED" "$PLIST_PATH"
sudo chown root:wheel "$PLIST_PATH"
sudo chmod 644 "$PLIST_PATH"
rm -f "$RENDERED"
ok "Installed: $PLIST_PATH"

if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
  sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi
sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
ok "LaunchDaemon loaded"

step 5 "Verifying HTTP response"
sleep 2
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$TR_BIND:$TR_PORT/" || echo "000")
if [[ "$HTTP" == "200" ]]; then
  ok "Service responding: HTTP $HTTP on http://$TR_BIND:$TR_PORT/"
else
  echo "[$MODULE_NAME] WARN: Service registered but HTTP $HTTP"
  echo "  Tail log: tail -50 /tmp/${LOG_PREFIX}-trading-research.log"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  UI:          http://$TR_BIND:$TR_PORT"
echo "  Watchlist:   $WATCHLIST"
echo "  Reminder:    DEMO ONLY. Not financial advice."
exit 0
