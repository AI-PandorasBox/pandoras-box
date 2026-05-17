# Recovery Runbook

<!-- _A4_ARCHITECTURE_DOCS_V1 -->

> What to do when something breaks. Read top-to-bottom on a quiet day; reach for the relevant section in a hurry.

## 1. First-response checklist

When you notice a degradation:

1. **Identify the affected layer** — is it the bridge (all LLM work stops), a specific tenant (one company affected), a specific module (one capability affected)?
2. **Check the relevant log** — `/tmp/pandoras-box-<service>.log` for the affected daemon.
3. **Verify the daemon is running** — `launchctl list | grep com.pandoras-box.` (system daemons) or `launchctl list | grep com.pandoras-box.` as the affected user (user-level agents).
4. **Restart the daemon** — `sudo launchctl stop com.pandoras-box.<service>; sudo launchctl start com.pandoras-box.<service>`. Wait 5-10 seconds, re-check.
5. **If it doesn't come back** — proceed to the targeted section below.

## 2. Bridge (Anthropic Claude connection)

**Symptoms:** All LLM-driven responses fail. Agents return "BRIDGE_AUTH failed" or similar.

**First check:**

```
claude --print --max-output-tokens 5 "ok"
```

If this fails, the Claude CLI is not signed in. Run `claude /login` and complete OAuth in the browser.

**If the CLI works but Pandora's Box agents still fail:**

```
sudo launchctl stop com.pandoras-box.mnemosyne
sudo launchctl start com.pandoras-box.mnemosyne
```

The bridge subprocess is owned by mnemosyne; restarting mnemosyne respawns it.

**Pending change watchpoint:** Anthropic's billing-model change (~15 June 2026) may require running `scripts/migrate-anthropic-2026-06.sh` once. The CHANGELOG entry tagged `_ANTHROPIC_2026_06_MIGRATION_V1` will surface this in your installation's announce file when the change ships. See [setup/anthropic.md](../setup/anthropic.md).

## 3. Argus (oversight daemon)

**Symptoms:** Job queue stalls. Jobs sit in `pending` state indefinitely. Agents queue work but nothing executes.

**Diagnose:**

```
launchctl list | grep com.pandoras-box.argus
sudo tail /tmp/pandoras-box-argus.log
```

If Argus is not running, restart:

```
sudo launchctl stop com.pandoras-box.argus
sudo launchctl start com.pandoras-box.argus
```

Argus has a watchdog that auto-restarts on crash. If it's repeatedly crashing, check its log for stack traces and open a GitHub issue with a sanitised excerpt.

**Argus cannot be disabled** — that's by design. If you need to bypass Argus for an emergency operation, the only path is `sudo launchctl unload /Library/LaunchDaemons/com.pandoras-box.argus.plist` and `sudo launchctl load …` to reload — but doing this leaves the system without oversight, so do it briefly and reload immediately.

## 4. MS365 token issues (per tenant)

**Symptoms:** Mail / Calendar / Files for one tenant fail with 401 Unauthorized.

**Diagnose:**

```
cat /opt/pandoras-box/<tenant>/ms365-auth/mail.token-cache.json | jq '.expiresOn'
```

Tokens auto-refresh on access. If the refresh token has expired (typically after 90 days of non-use), re-auth is needed.

**Recover:**

Re-run the installer's MS365 step for the affected tenant:

```
sudo bash /opt/pandoras-box/scripts/add-module.sh ms365-<tenant>
```

The installer guides you through device-flow re-auth (browser opens; you sign in; new tokens are stored).

If the Azure AD app registration itself has been deleted, you'll need to recreate it per [setup/ms365.md](../setup/ms365.md).

## 5. Personal AI offline

**Symptoms:** Phone or web UI can't reach the Personal AI. Browser shows connection refused or timeout.

**First — verify the daemon is running:**

```
launchctl list | grep com.pandoras-box.mnemosyne
```

If absent, restart:

```
sudo launchctl stop com.pandoras-box.mnemosyne
sudo launchctl start com.pandoras-box.mnemosyne
```

**Then — verify Tailscale is up (if you're connecting from outside the LAN):**

```
tailscale status
```

Should show your Mac as Connected. If not, open the Tailscale app and sign in.

**Then — verify the cert hasn't expired (if you're using a self-signed cert):**

Browser shows "your connection is not private" with a cert-error code. Tap "Show details" then "Visit this website" once to accept the cert. If the cert has been rotated, you'll need to accept the new fingerprint.

## 6. Tenant agent offline (one company affected)

**Symptoms:** One tenant's conductor or task agents not responding.

**Diagnose:**

```
launchctl list | grep com.pandoras-box.tenant-<n>
```

Restart the conductor + task agents for that tenant:

```
for svc in com.pandoras-box.tenant-<n>-conductor com.pandoras-box.tenant-<n>-mail com.pandoras-box.tenant-<n>-calendar com.pandoras-box.tenant-<n>-files com.pandoras-box.tenant-<n>-voice; do
  sudo launchctl stop $svc
  sudo launchctl start $svc
done
```

If only one task agent (e.g. mail) is failing, restart just that one. The conductor is independent of the task agents.

## 7. Daemon repeatedly crashing (every few seconds)

**Symptoms:** Service shows in `launchctl list` with a non-zero exit status that keeps changing. Watchdog respawns it; it crashes again. CPU spikes briefly every few seconds.

**Diagnose:**

```
sudo tail -100 /tmp/pandoras-box-<service>.log
```

Look for the most recent stack trace. Common causes:

- **Database lock** — SQLite lock from a previous unclean shutdown. Stop the daemon, run `sqlite3 /opt/pandoras-box/<tenant>/store/<db>.db ".recover" | sqlite3 /opt/pandoras-box/<tenant>/store/<db>.db.recovered` and swap.
- **Missing keychain entry** — restore the missing keychain item via `security add-generic-password -s <KEY_NAME> -a default -w` and paste the value.
- **Node version mismatch** — verify Node ≥ 22 with `node --version`. The installer enforces this at install time, but a system update can break it.
- **Out of disk space** — `df -h`. If full, free space (especially around the the Offline Knowledge Library ZIM dir if you have Kiwix installed; ZIMs are large).

**If unsure**, open a GitHub issue with the sanitised log excerpt.

## 8. the Content Classifier content classifier offline

**Symptoms:** Outbound content classification stops (or starts allowing everything through, depending on fail-open / fail-closed config).

**Recover:**

```
sudo launchctl stop com.pandoras-box.content-classifier
sudo launchctl start com.pandoras-box.content-classifier
```

If the model files have been corrupted (rare, usually disk full), re-pull:

```
sudo bash /opt/pandoras-box/content-classifier/scripts/refresh-model.sh
```

This re-downloads the ~600 MB GLiGuard model from HuggingFace.

## 9. Out of disk space

**Symptoms:** Daemons fail to start. SQLite write errors. New chats fail.

**Diagnose:**

```
df -h
```

**Common consumers:**

- **the Offline Knowledge Library ZIM** at `/opt/pandoras-box/offline-kb/zim/` — Wikipedia archives, ~30-80 GB
- **the Media Production Pipeline generated content** at `/opt/pandoras-box/media-production/output/` — video outputs can be 100 MB each
- **Backup snapshots** at `/opt/pandoras-box/snapshots/` — limited to 3 retained by default but can grow if backup pruning fails

Free space, restart affected daemons.

## 10. Backup / restore

Backups happen nightly via the Encrypted Backups module (if installed). To restore:

```
sudo bash /opt/pandoras-box/scripts/restore-from-backup.sh /path/to/backup.tar.gz.age
```

You'll be prompted for the age decryption key (stored in your Keychain under `pbox-backup-age-key`).

## 11. When you need to ask for help

Sanitise any log excerpt you share publicly — strip personal names, customer data, internal email subjects, API keys. Use the project's `.sanitize-allowlist` patterns as a guide.

Open a GitHub Issue with:

- macOS version (`sw_vers`)
- Node version (`node --version`)
- Installed modules (list)
- Sanitised log excerpt covering 30 seconds either side of the failure
- Steps to reproduce
- What you expected vs what happened

## Reference

- [Architecture Layer Model](layers.md)
- [Service dependencies](dependencies.md)
- [Setup — MS365](../setup/ms365.md)
- [Setup — Tailscale](../setup/tailscale.md)
- [Setup — Anthropic auth](../setup/anthropic.md)
