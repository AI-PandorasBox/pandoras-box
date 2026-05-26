# System Administrator Guide

**Version:** 1.0  
**Audience:** System operators managing day-to-day administration

---

## Disclaimer

This software is provided under the MIT License on an "as-is" basis, without warranty.
You are responsible for the security of your system, your credentials, and your running costs.
Nothing in this guide constitutes professional advice.

---

## 1. Admin Interfaces

Your system provides four interfaces for administration. Each serves a different purpose.

### Admin Shell

The Admin Shell is a Chrome desktop application that opens on your Mac. It provides:
- Service status overview
- Log viewer
- Job queue monitor
- Deploy controls

To open it: click the Admin Shell icon in your Applications folder or Dock.

### Dashboard

The Dashboard is a web page accessible on your local network. It shows service status,
recent job activity, and system health at a glance.

Access: `http://[your-mac-hostname].local:8181` or `http://[your-local-IP]:8181`

### Terminal

The Terminal is a browser-based shell, password-protected, accessible on your local network.
It gives you a command line without opening the Terminal app.

Access: `http://[your-mac-hostname].local:8282`

### Admin Panel (Mobile)

The Admin Panel is a mobile-friendly interface accessible via Tailscale from any device.
It requires a PIN to log in. It lets you check service status, view logs, and send commands
from your phone.

Access: `https://[your-tailscale-address]:8787`

---

## 2. Daily Monitoring

You do not need to check your system every day -- it runs unattended. However, if something
seems wrong (no morning briefing, agents not responding), start here.

### Quick health check

In the Admin Shell or Terminal, run:

```
launchctl list | grep pandoras-box
```

You should see one entry per service, all with exit code `0` (the number after the second
dash in each line). Any non-zero exit code means the service stopped unexpectedly.

### Check the job queue

```
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/var/ai-jobs/jobs.db');
console.table(db.prepare('SELECT id,company,task_type,status,created_at FROM jobs ORDER BY created_at DESC LIMIT 10').all());
db.close()
"
```

This shows the last 10 jobs. Look for anything stuck in `pending` for more than a few minutes.

### Check logs for errors

```
tail -50 /tmp/pandoras-box-[company]-conductor.log
```

Replace `[company]` with your company slug (e.g. `company-a`). Look for lines starting
with `ERROR` or `FATAL`.

---

## 3. Reading Logs

Each service writes to a log file in `/tmp/`. The naming pattern is:

```
/tmp/pandoras-box-[company]-conductor.log    -- company conductor
/tmp/pandoras-box-[company]-mail.log         -- mail agent
/tmp/pandoras-box-[company]-calendar.log     -- calendar agent
/tmp/pandoras-box-[company]-files.log        -- files agent
/tmp/pandoras-box-muse.log                   -- personal assistant
/tmp/pandoras-box-argus.log                  -- security overseer
```

**What to look for:**

| Log pattern | What it means |
|-------------|---------------|
| `[INFO]` | Normal operation. No action needed. |
| `[WARN]` | Something unexpected but not fatal. May need attention. |
| `[ERROR]` | A specific operation failed. Review the message. |
| `[FATAL]` | The service crashed. It will restart automatically. |
| `Job approved` | Security Overseer approved a job. Normal. |
| `Job blocked` | Security Overseer blocked a job. Review the reason. |
| `Auth error` | An API call was rejected (key expired or invalid). |

**Viewing logs in real time:**

```
tail -f /tmp/pandoras-box-[company]-conductor.log
```

Press Control+C to stop.

---

## 4. The Job Queue

All actions taken by your agents pass through a central job queue. Every action is:
1. Written to the queue by the conductor
2. Reviewed and approved (or blocked) by the Security Overseer
3. Executed by the appropriate task agent
4. Marked as complete (or failed)

This means you can always audit what your agents have done. Nothing bypasses the queue.

### Job statuses

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for Security Overseer review |
| `approved` | Approved, waiting for the task agent |
| `blocked` | Rejected by Security Overseer |
| `complete` | Successfully executed |
| `failed` | Attempted but failed (see job payload for reason) |

### What to do with blocked jobs

If a job is blocked, the Security Overseer has flagged it as outside the expected pattern.
This might be:
- A new type of task the system has not seen before
- A request that looked anomalous (unusual payload, unexpected timing)
- A genuine security concern

To understand why a job was blocked:
```
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/var/ai-jobs/jobs.db');
const row=db.prepare('SELECT * FROM jobs WHERE status=\"blocked\" ORDER BY created_at DESC LIMIT 5').all();
console.log(JSON.stringify(row,null,2));
db.close()
"
```

The `payload` field will contain the reason for blocking.

---

## 5. Restarting Services

### Restart a single service

```
sudo launchctl stop com.pandoras-box.[service] && sudo launchctl start com.pandoras-box.[service]
```

Example: restart the Company A conductor:
```
sudo launchctl stop com.pandoras-box.company-a-conductor && sudo launchctl start com.pandoras-box.company-a-conductor
```

### Restart all company conductors

```
for svc in $(launchctl list | grep pandoras-box.*conductor | awk '{print $3}'); do
  sudo launchctl stop "$svc" && sudo launchctl start "$svc"
done
```

### Restart everything

```
for svc in $(launchctl list | grep pandoras-box | awk '{print $3}'); do
  sudo launchctl stop "$svc" && sudo launchctl start "$svc"
done
```

**Note:** Services restart automatically after a Mac reboot. Manual restarts are needed
only when a service has stopped unexpectedly or after a configuration change.

---

## 6. Adding a New Company

To add a new company (new tenant) after initial installation:

```
sudo bash /opt/pandoras-box/scripts/add-tenant.sh
```

The script runs the same wizard as the installer's company setup step. Your existing
companies are not affected.

After adding a company, you will need to run the Microsoft 365 or Google authentication
flow for the new company's base directory.

---

## 7. Adding or Removing Modules

### Add a module

```
sudo bash /opt/pandoras-box/scripts/add-module.sh
```

The script shows the module catalog and lets you select one to install.

### Remove a module

```
sudo bash /opt/pandoras-box/scripts/remove-module.sh [module-name]
```

Example:
```
sudo bash /opt/pandoras-box/scripts/remove-module.sh ollama
```

**Note:** Removing a module stops and removes the related services. It does not delete
any data (email, calendar events, documents) -- only the agent process and its configuration.

---

## 8. Updating Credentials

### Rotating an Anthropic API key

1. Go to console.anthropic.com -> API Keys -> create a new key
2. Update the `.env` file for each company:
   ```
   sudo nano /opt/pandoras-box/[company-slug]/.env
   ```
3. Change the `ANTHROPIC_API_KEY=` line to your new key
4. Restart the conductor for that company

### Rotating a Microsoft 365 client secret

1. Go to portal.azure.com -> App registrations -> your app -> Certificates & secrets
2. Create a new client secret (note the expiry date)
3. Update the `.env` file:
   ```
   sudo nano /opt/pandoras-box/[company-slug]/.env
   ```
4. Change the `MS365_CLIENT_SECRET=` line
5. Restart the conductor

### Re-authorising Microsoft 365 or Google

OAuth tokens expire (typically after 90 days for some providers). If agents stop
accessing email or calendar, re-authentication is needed.

The re-auth command is logged in your installation notes. For Microsoft 365:
```
node /opt/pandoras-box/[company]/node_modules/@softeria/ms-365-mcp-server/dist/index.js --login --org-mode
```

Run this in the terminal as your regular user (not sudo).

---

## 9. The Project System

The project system is how you request new features, automations, and changes to your
AI system. Instead of editing code yourself, you describe what you want, and the System
Administrator builds it for you.

### How it works

1. Ask your admin agent to start a project, in plain language:
   ```
   Create a project: <describe what you want, e.g. a weekly sales summary emailed every Friday at 17:00>.
   ```
   For example: "Add a weekly sales summary that emails me every Friday at 17:00"

2. The System Administrator reads the brief, assesses feasibility and security, and either
   approves it for build or asks a clarifying question.

3. Once approved, the System Administrator builds the change and stages it for your review.

4. You review the staged files and, if satisfied, confirm deployment.

5. The System Administrator deploys and verifies the change.

### Project lifecycle

```
pending -> brief ready -> in progress -> review needed -> approved -> deployed
```

At each stage you may be asked to confirm or provide input.

### Checking project status

Open the Admin Shell, navigate to the Projects tab. Or view the project files directly
in the Projects tab.

---

## 10. Building New Features

Your AI system can be extended to do almost anything that can be automated on a Mac
with API access. Common extensions:

- **Custom automations:** "Every Monday morning, pull last week's sales from [system]
  and send me a summary"
- **New integrations:** connect your AI to a CRM, accounting software, or any system
  with an API
- **Custom alert rules:** "Alert me if more than 10 emails arrive from unknown senders
  in one hour"
- **Scheduled reports:** "At 17:30 every Friday, summarise the week's completed jobs
  and email it to me"
- **Workflow automations:** multi-step processes triggered by events

To request a new feature, use the project system (see Section 9 above).

---

## 11. Adding Automations

Automations are scheduled or event-triggered actions that run without you asking.
Your morning briefing is an example of an automation.

To add a new automation:
1. Describe what you want in plain language
2. Create a project with that description
3. The System Administrator will design the automation, assess any security implications,
   and stage the implementation for your review

All automations are logged in the job queue, reviewed by the Security Overseer before
they run, and can be disabled or removed via a remove-module or project request.

---

## 12. Deploy Flow

When a change is ready to deploy, the process is:

1. The System Administrator stages all changes to `/staged/` directories
2. Changes are reviewed (by you or the System Administrator)
3. The System Administrator writes a `deploy.sh` script
4. You run Deploy.app (or click Deploy in the Admin Shell)
5. The System Administrator verifies the deployment functionally
6. If verification passes, the deploy is logged in the changelog

**Nothing is ever deployed automatically.** Every deploy requires your explicit action.
DRY_RUN mode is enabled by default -- the deploy script does nothing until you confirm
the scope is correct and authorise the live run.
