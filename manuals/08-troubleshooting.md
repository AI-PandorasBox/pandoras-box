# Troubleshooting Guide

**Version:** 1.0  
**Audience:** Anyone diagnosing system issues

---

## Disclaimer

This software is provided under the MIT License on an "as-is" basis, without warranty.
If you cannot resolve an issue using this guide, open a GitHub issue with the relevant
log output.

---

## How to Use This Guide

Each section follows this format:

1. **Symptom** -- what you observe
2. **Likely cause** -- what usually causes it
3. **Fix** -- what to do, explained in plain English, then the actual command

If you cannot find your specific symptom, check the relevant section and look for the
closest match. Many issues have the same root cause.

---

## 1. Service Not Running

### Symptom
An agent is not responding, or the Admin Shell shows a service as red/stopped.

### Likely cause
The service crashed, was stopped manually, or failed to start after a Mac restart.

### Fix

**Check which services are running:**
```
launchctl list | grep pandoras-box
```

Each service appears as a line with three fields: process ID, exit code, and label.
An exit code of `0` means it is running normally. A non-zero code means it stopped.

**Restart a specific service:**
```
sudo launchctl stop com.pandoras-box.[service-label]
sudo launchctl start com.pandoras-box.[service-label]
```

Replace `[service-label]` with the full label from the `launchctl list` output, for example
`com.pandoras-box.company-a-conductor`.

**Restart all services:**
```
for svc in $(launchctl list | grep pandoras-box | awk '{print $3}'); do
  sudo launchctl stop "$svc"
  sudo launchctl start "$svc"
done
```

**If the service keeps stopping:**
Check the log for the crash reason:
```
tail -50 /tmp/pandoras-box-[company]-conductor.log
```

Look for `ERROR` or `FATAL` lines just before the service stopped. The message usually
explains the cause (authentication error, database error, missing file, etc.).

---

## 2. Security Overseer Blocking Jobs

### Symptom
You send a request and get a response saying the job was blocked. Or you see a blocked
job alert via your relay channel.

### Likely cause
The Security Overseer flagged the job as outside the expected pattern. This is usually
a false positive for new types of requests. Less commonly, it may indicate a genuine
anomaly (an unusual email triggering an unusual request, for example).

### Fix

**Review why the job was blocked:**
```
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/var/ai-jobs/jobs.db');
const rows=db.prepare('SELECT id,company,task_type,payload FROM jobs WHERE status=\"blocked\" ORDER BY created_at DESC LIMIT 5').all();
console.log(JSON.stringify(rows,null,2));
db.close()
"
```

Read the `payload` field for each blocked job. The blocking reason is recorded there.

**If the block is a false positive:**
The most common false positives are:
- A new type of task the system has not seen before
- An unusually large email triggering a rate limit
- A request phrased in a way that pattern-matched a known concern

For a false positive, simply rephrase and re-send the request. If the same request type
keeps being blocked, use the project system to ask the System Administrator to tune the
allowlist.

**If the block looks like a real concern:**
Stop the affected conductor immediately and review the logs:
```
sudo launchctl stop com.pandoras-box.[company]-conductor
tail -100 /tmp/pandoras-box-[company]-conductor.log
```

See the Security Guide (Manual 4) for the full incident response procedure.

---

## 3. Microsoft 365 Authentication Expired

### Symptom
The Mail Agent, Calendar Agent, or Files Agent returns errors like "Auth error",
"Token expired", or "401 Unauthorized" when handling Microsoft 365 requests.

### Likely cause
Microsoft 365 OAuth tokens expire. The access token typically lasts 1 hour; the refresh
token lasts up to 90 days. If the daily token refresh has not been running, or the
refresh token itself has expired, re-authentication is needed.

### Fix

**Check when the token last refreshed:**
```
tail -20 /tmp/zeus-ms365-refresh.log
```

Look for the last successful refresh timestamp. If it is more than 24 hours ago, the
refresh job may not be running.

**Re-run the token refresh manually:**
```
bash modules/mail-ms365/install.sh   # re-run to re-authenticate
```

Replace `[company]` with the relevant company slug (e.g. `company-a`).

**If the refresh token has expired (full re-authentication required):**

Run the login flow for the company. The correct command is shown in your installation
notes. The general form is:

```
MS365_MCP_TOKEN_CACHE_PATH=/opt/pandoras-box/[company]/store/ms365-auth/.token-cache.json \
node /opt/pandoras-box/[company]/node_modules/@softeria/ms-365-mcp-server/dist/index.js \
--login --org-mode
```

A browser window will open. Sign in with the company's Microsoft 365 account. After
authenticating, close the browser and press Ctrl+C in the terminal.

**After re-authentication, restart the conductor:**
```
sudo launchctl stop com.pandoras-box.[company]-conductor
sudo launchctl start com.pandoras-box.[company]-conductor
```

---

## 4. Google Workspace Authentication Expired

### Symptom
The Mail, Calendar, or Files Agent returns errors for Google Workspace requests.

### Likely cause
Google OAuth refresh tokens expire if unused for 6 months, or if the OAuth consent
screen is set to "Testing" mode and the token was issued more than 7 days ago.

### Fix

**Re-authenticate:**
Re-run the Google OAuth flow for the affected company. The login command is in your
installation notes.

If you set up the Google Cloud project in "Testing" mode, move it to "Published" in
the Google Cloud Console to get longer-lived tokens.

**After re-authentication:**
```
sudo launchctl stop com.pandoras-box.[company]-conductor
sudo launchctl start com.pandoras-box.[company]-conductor
```

---

## 5. Certificate Errors in Browser

### Symptom
Browser shows "Your connection is not private", "NET::ERR_CERT_AUTHORITY_INVALID",
or a red padlock. You cannot access the browser interface.

### Likely cause
The CA certificate is not installed on this device, or it is installed but not trusted.

### Fix

**On Mac:**
1. Find `PandorasBox-CA.crt` on your Desktop (it was saved there during installation)
2. Double-click it -- Keychain Access opens
3. Choose "System" keychain -> Add
4. Find "Pandoras Box CA" in Keychain Access, double-click it
5. Expand "Trust" -> set "When using this certificate" to "Always Trust"
6. Close and enter your password to save
7. Quit and relaunch your browser

**On iPhone:**
1. AirDrop or email yourself the `PandorasBox-CA.crt` file
2. Open it on iPhone -- tap Allow to download the profile
3. Settings -> General -> VPN & Device Management -> tap the profile -> Install
4. Settings -> General -> About -> Certificate Trust Settings -> enable the CA

**On Android:**
Settings -> Security -> Install from storage -> find and select the `.crt` file.

Full instructions for all devices: `docs/certificates.md`

**If the certificate has expired:**
Run the renewal script on the server:
```
sudo bash /opt/pandoras-box/pbox-renew-cert.sh
```
Then reinstall the certificate on your devices.

---

## 6. Tailscale Not Connecting

### Symptom
You cannot access the system remotely. The Admin Panel, Personal Assistant browser
interface, or documentation server is unreachable from your phone.

### Likely cause
Tailscale is not running on the server, your device, or both. Or the devices are not
on the same Tailscale account.

### Fix

**Check if Tailscale is running on the server:**
Look for the Tailscale icon in the menu bar (top right of the Mac screen). If it is
missing, Tailscale has quit.

To restart Tailscale: open the Applications folder, find Tailscale, and open it.

**Check if your device is connected:**
Open the Tailscale app on your phone. It should show your server in the device list
with a green dot.

**If the device list is empty:**
Make sure you are signed in to Tailscale with the same account on both the server and
your phone. Both must be logged in to the same Tailscale account.

**If Tailscale shows connected but the browser cannot reach the system:**
Check that the services are running (`launchctl list | grep pandoras-box`).
Check that you are using the correct Tailscale address. Find it by clicking the
Tailscale menu bar icon on the server.

---

## 7. Agent Not Responding

### Symptom
You send a message via your relay channel and receive no response, or receive a
generic error.

### Likely cause
- The conductor is stopped
- The relay connection has dropped
- An authentication error is preventing the conductor from processing

### Fix

**Step 1: Check the conductor is running:**
```
launchctl list | grep [company]-conductor
```

If it is not listed, or has a non-zero exit code, restart it:
```
sudo launchctl stop com.pandoras-box.[company]-conductor
sudo launchctl start com.pandoras-box.[company]-conductor
```

**Step 2: Check the conductor log for errors:**
```
tail -50 /tmp/pandoras-box-[company]-conductor.log
```

**Step 3: Test the relay connection:**
Send a simple test message: "ping" or "hello". If the conductor is running but the
relay is disconnected, you will see a connection error in the log.

**If the relay token has expired (Telegram/Discord/Slack):**
Generate a new bot token from the relevant platform and update the `.env` file:
```
sudo nano /opt/pandoras-box/[company]-conductor/.env
```
Update the relevant token line. Restart the conductor.

---

## 8. Job Queue Stuck (Jobs Staying in "Pending")

### Symptom
Jobs are written to the queue but stay in "pending" status for more than a few minutes.

### Likely cause
The Security Overseer is stopped, or there is a database lock on the job queue.

### Fix

**Check if the Security Overseer is running:**
```
launchctl list | grep pandoras-box.argus
```

If stopped:
```
sudo launchctl stop com.pandoras-box.argus
sudo launchctl start com.pandoras-box.argus
```

**Check for a database lock:**
```
ls -la /var/ai-jobs/
```

If you see a `.db-wal` or `.db-shm` file that is very large (gigabytes), the database
may have been corrupted. Check the Security Overseer log for errors:
```
tail -50 /tmp/pandoras-box-argus.log
```

**If the database is corrupted:**
Stop all services, make a backup of the database, then use the SQLite recovery tools:
```
sudo launchctl stop com.pandoras-box.argus
cp /var/ai-jobs/jobs.db /var/ai-jobs/jobs.db.backup
sqlite3 /var/ai-jobs/jobs.db "PRAGMA integrity_check;"
```

If integrity_check returns errors, contact the System Administrator via the project system.

---

## 9. Common Installer Errors

### "command not found: brew"

**Cause:** Homebrew is not installed, or it is installed but not in your PATH.  
**Fix:** Install Homebrew from brew.sh, then run the installer again. If it is installed
but not found, add it to your PATH:
```
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### "command not found: node"

**Cause:** Node.js is not installed.  
**Fix:**
```
brew install node
```
Then restart your terminal and run the installer again.

### "Permission denied: /opt/pandoras-box"

**Cause:** The installer was not run with sudo.  
**Fix:**
```
sudo bash pbox-setup.sh
```

### "Claude sign-in: not authenticated"

**Cause:** The Claude CLI is not signed in, or the session has expired.  
**Fix:** Run `claude /login` and complete the browser sign-in with your Claude Pro or Max
account. Verify with `claude --print --max-output-tokens 5 "ok"`.

### "Azure app registration not found" or "401 from Microsoft Graph"

**Cause:** The client ID, tenant ID, or client secret was entered incorrectly, or
the app registration does not have admin consent for the required permissions.  
**Fix:** Go to portal.azure.com, find your app registration, verify the IDs, and make
sure you clicked "Grant admin consent" on the API permissions page.

### "tailscale: not found"

**Cause:** Tailscale is not installed on the Mac.  
**Fix:** Download from tailscale.com/download/mac, install, sign in, then re-run the
installer.

### "openssl: command not found"

**Cause:** OpenSSL is not installed (unusual on macOS, which ships with LibreSSL).  
**Fix:**
```
brew install openssl
```

---

## 10. Getting Further Help

If this guide does not resolve your issue:

1. Collect the relevant log file:
   ```
   cat /tmp/pandoras-box-[service].log > /tmp/pbox-issue-log.txt
   ```

2. Note your macOS version:
   ```
   sw_vers -productVersion
   ```

3. Note your Node.js version:
   ```
   node --version
   ```

4. Open a GitHub issue at: https://github.com/AI-PandorasBox/pandoras-box/issues

Include the log output (remove any API keys or personal data before posting),
your macOS and Node.js versions, and a clear description of what you were doing
when the issue occurred.
