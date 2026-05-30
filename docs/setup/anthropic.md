# Setup — Anthropic auth (Claude)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

Pandora's Box routes every Claude API call through a per-session bridge subprocess (`shared/anthropic-claude-adapter.mjs`). Authentication is via your Claude Pro or Max subscription:

| Path | What you need | Cost model |
|---|---|---|
| **Claude Pro / Max subscription** | A Claude.ai account on the Pro or Max plan, signed in via `claude /login` | Flat monthly subscription. No per-call charge. Bridge uses your session cookie. |

API-key (pay-per-token) billing is not supported in this release. API support is planned for a future version.

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

## API-key billing

API-key (pay-per-token) billing is not supported in this release. API support is planned for a future version. For now, all installs run on a Claude Pro or Max subscription via `claude /login`.

## Pending billing changes (~15 June 2026)

Anthropic has announced billing-model changes taking effect approximately 15 June 2026. The known consequences for Pandora's Box operators:

- **More functionality unlocked via subscription** — extended capabilities (e.g. longer context, batch processing) are expected to become accessible to Pro / Max subscribers.
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

Then restart any running Pandora's Box agents — they will fail with auth errors as expected until you sign in again with `claude /login`.
