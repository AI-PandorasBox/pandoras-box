# Setup — Anthropic auth (Claude)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

Pandora's Box routes every Claude API call through a per-session bridge subprocess (`shared/anthropic-claude-adapter.mjs`). The bridge supports two auth paths:

| Path | What you need | Cost model |
|---|---|---|
| **Claude Pro / Max subscription** (recommended) | A Claude.ai account on the Pro or Max plan, signed in via `claude /login` | Flat monthly subscription. No per-call charge. Bridge uses your session cookie. |
| **API key** (alternative) | An API key from console.anthropic.com | Pay-per-token. Pricing varies by model — see Anthropic's billing page. |

## Recommended setup — Claude Pro / Max

1. Sign up for a Claude.ai account at https://claude.ai if you don't already have one.
2. Subscribe to **Claude Pro** or **Claude Max** at https://claude.ai/upgrade.
3. Install the Claude Code CLI:
   ```
   brew install claude
   ```
   Or follow the install instructions at https://claude.com/claude-code.
4. Sign in:
   ```
   claude /login
   ```
   This opens a browser tab; complete OAuth in the browser; the CLI captures the session token. No API key paste.
5. Verify:
   ```
   claude --print --max-output-tokens 5 "ok"
   ```
   You should see a short response. The Pandora's Box installer runs the same check and reports `Claude CLI: signed in` on success.

The bridge is now ready. Every agent in your install uses this single sign-in.

## Alternative — API key

If you prefer pay-per-token billing:

1. Create an API key at https://console.anthropic.com/settings/keys.
2. Add it to macOS Keychain:
   ```
   security add-generic-password -s ANTHROPIC_API_KEY -a default -w
   ```
   Paste the key when prompted (it isn't visible on screen).
3. In your tenant's `.env`, set `BRIDGE_AUTH=api_key`.

Caveat: API key mode bypasses the bridge's session-stability optimisations. Prompt caching across agents in the same tenant is less effective. Cost is meaningfully higher for typical workloads — most operators are better off on Pro / Max.

## Pending billing changes (~15 June 2026)

Anthropic has announced billing-model changes taking effect approximately 15 June 2026. The known consequences for Pandora's Box operators:

- **More functionality unlocked via subscription** — features that previously required an API key (e.g. extended SDK surface, longer context, batch processing) are expected to become accessible to Pro / Max subscribers.
- **A one-time migration step on the operator side** — when the change ships, the bridge will need a refresh. We'll publish a migration script under `scripts/migrate-anthropic-2026-06.sh` with a `--dry-run` mode.
- **No code changes required to run Pandora's Box at v1.0** — the v1.0 release works against today's Anthropic billing model. The migration ships as a follow-on patch when Anthropic publishes the change.

We monitor this via the upstream scanner (the Self-Improvement Pipeline weekly poll of Anthropic announcements). When the change lands, we publish:
1. A CHANGELOG entry tagged `_ANTHROPIC_2026_06_MIGRATION_V1`.
2. A migration script with a `--dry-run` mode.
3. Updated guidance in this file with the exact before / after config.

## Troubleshooting

- **`claude /login` opens a tab but the CLI doesn't return.** Some users on first-time install hit a cookie issue. Quit the CLI with Ctrl-C, run `claude /logout`, then `claude /login` again.
- **`claude --print` returns an authentication error.** Your session has expired. Re-run `claude /login`.
- **Pandora's Box agents return "BRIDGE_AUTH failed".** Verify Claude Code CLI is signed in (`claude --print --max-output-tokens 5 "ok"`), then restart the affected agent: `launchctl stop com.pandoras-box.<agent>; launchctl start com.pandoras-box.<agent>`.

## Revoking access

To sign out:
```
claude /logout
```

To revoke a stored API key:
```
security delete-generic-password -s ANTHROPIC_API_KEY
```

Followed by deleting the API key in the Anthropic console at https://console.anthropic.com/settings/keys. Then restart any running Pandora's Box agents — they will fail with auth errors as expected until you reinstate auth.
