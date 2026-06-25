# =============================================================================
# setup-mcp-settings.sh -- Generate the per-tenant .claude/settings.json that
# gives the mail / calendar / files task agents their provider MCP surface.
#
# This is the keystone the task agents read at boot:
#   <slug>/.claude/settings.json -> { "mcpServers": { ... } }
# Without it, loadMcpServers() returns {} and the agents have no provider tools
# (the reason multi-tenant mail looked "scaffolded" -- the runtime was present,
#  this file was never written).
#
# Provider support:
#   MS365  (MS365_CLIENT_ID set)  -> @softeria/ms-365-mcp-server, preset
#                                    mail,calendar,files, --org-mode. PROVEN.
#   Google (GOOGLE_CLIENT_ID set) -> the agent expects mcp__gmail__* tools, but
#                                    no Gmail MCP server ships yet. Marked PREVIEW
#                                    here rather than writing a dead server entry.
# =============================================================================

# write_tenant_mcp_settings <slug> <service_user>
write_tenant_mcp_settings() {
  local slug="$1"
  local user="${2:-root}"
  local base_dir="$INSTALL_PATH/$slug"
  local base_env="$base_dir/.env"
  local claude_dir="$base_dir/.claude"
  local settings="$claude_dir/settings.json"

  [[ -f "$base_env" ]] || { warn_msg "[mcp-settings] no .env for $slug -- skipping"; return 0; }

  # Provider detection from the tenant .env (same rule the agent uses).
  local has_ms365=0 has_google=0
  grep -qE '^MS365_CLIENT_ID=.+'  "$base_env" && has_ms365=1
  grep -qE '^GOOGLE_CLIENT_ID=.+' "$base_env" && has_google=1

  if [[ "$has_ms365" != "1" && "$has_google" != "1" ]]; then
    info_msg "[mcp-settings] $slug is chat-only (no mail provider) -- no MCP settings needed."
    return 0
  fi

  sudo mkdir -p "$claude_dir" "$base_dir/store/ms365-auth" "$base_dir/store/google-auth"

  # The MS365 MCP server binary lives in the mail agent's node_modules (installed
  # by install_tenant_runtimes). Absolute path so any agent dir can launch it.
  local ms365_bin="$INSTALL_PATH/${slug}-mail/node_modules/@softeria/ms-365-mcp-server/dist/index.js"
  local ms365_cache="$base_dir/store/ms365-auth/token-cache.json"

  if [[ "$has_ms365" == "1" ]]; then
    # Single ms365 server, full surface (mail,calendar,files) so the shared
    # settings.json serves all three task agents. --org-mode = work/Graph scopes.
    sudo tee "$settings" >/dev/null <<JSON
{
  "mcpServers": {
    "ms365": {
      "command": "node",
      "args": [
        "${ms365_bin}",
        "--preset", "mail,calendar,files",
        "--org-mode"
      ],
      "env": {
        "MS365_MCP_TOKEN_CACHE_PATH": "${ms365_cache}"
      }
    }
  }
}
JSON
    info_msg "[mcp-settings] $slug -> ms365 MCP surface written (mail,calendar,files)."
  elif [[ "$has_google" == "1" ]]; then
    # Google path: the agent expects mcp__gmail__* tools; no Gmail MCP server
    # ships yet. Write an empty-but-valid settings.json and flag PREVIEW so the
    # operator is not silently left with a dead provider.
    sudo tee "$settings" >/dev/null <<'JSON'
{
  "mcpServers": {}
}
JSON
    warn_msg "[mcp-settings] $slug uses Google -- the Gmail MCP surface is PREVIEW and not yet wired."
    warn_msg "             Mail actions will be inert until the Gmail MCP server ships. MS365 is the supported provider today."
  fi

  sudo chown -R "${user}:staff" "$claude_dir" "$base_dir/store" 2>/dev/null \
    || sudo chown -R "$user" "$claude_dir" "$base_dir/store" 2>/dev/null || true
  sudo chmod 700 "$claude_dir" "$base_dir/store/ms365-auth"
  sudo chmod 600 "$settings"
  check_pass "MCP settings staged for $slug."
}

# login_tenant_ms365 <slug> <service_user>
# Runs the interactive MS365 device/browser login so the token cache is
# populated before the agent first polls. Idempotent: --verify-login first.
login_tenant_ms365() {
  local slug="$1"
  local user="${2:-root}"
  local base_dir="$INSTALL_PATH/$slug"
  local ms365_bin="$INSTALL_PATH/${slug}-mail/node_modules/@softeria/ms-365-mcp-server/dist/index.js"
  local cache="$base_dir/store/ms365-auth/token-cache.json"
  local node_bin; node_bin="$(command -v node)"

  [[ -f "$ms365_bin" ]] || { warn_msg "[ms365-login] server not installed yet for $slug -- run after npm install."; return 0; }

  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[ms365-login] (dry-run) skipping interactive login for $slug."
    return 0
  fi

  echo ""
  echo "  --- Microsoft 365 sign-in for $slug ---"
  echo "  A device-code prompt will appear. Open the URL, enter the code, and"
  echo "  approve with the Microsoft 365 account this agent should act as."
  echo ""

  if sudo -u "$user" env MS365_MCP_TOKEN_CACHE_PATH="$cache" \
        "$node_bin" "$ms365_bin" --verify-login --org-mode >/dev/null 2>&1; then
    check_pass "$slug already signed in to Microsoft 365."
    return 0
  fi

  sudo -u "$user" env MS365_MCP_TOKEN_CACHE_PATH="$cache" \
      "$node_bin" "$ms365_bin" --login --org-mode \
    || { warn_msg "[ms365-login] login did not complete for $slug. Re-run later: bash $INSTALL_PATH/lib/setup-company.sh"; return 0; }

  if sudo -u "$user" env MS365_MCP_TOKEN_CACHE_PATH="$cache" \
        "$node_bin" "$ms365_bin" --verify-login --org-mode >/dev/null 2>&1; then
    check_pass "$slug signed in to Microsoft 365."
  else
    warn_msg "[ms365-login] could not verify $slug sign-in. The agent will report a re-login prompt until resolved."
  fi
}
