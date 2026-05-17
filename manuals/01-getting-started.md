# Getting Started with Your AI System

**Version:** 1.0  
**Audience:** New users, no technical background required

---

## Disclaimer

This software is provided under the MIT License on an "as-is" basis, without warranty of
any kind. You are responsible for your API costs and spend limits. You are responsible for
the security of your credentials and the machine the system runs on. Nothing in this manual
constitutes financial, legal, or professional advice.

---

## 1. What Is This System?

Your AI system is a set of AI assistants that live on your Mac, work for your businesses,
and are available around the clock.

Unlike cloud AI tools (ChatGPT, Copilot, etc.) where you type questions into a website, this
system runs continuously in the background. It watches your inbox, prepares your briefings,
and handles tasks on request -- without you opening a browser or logging in each time.

**The core idea:** you talk to your AI, your AI handles the task, you review and approve
anything that goes out.

### What your system includes

- A **Personal Assistant** -- your own AI for daily life and work. Morning briefings, email
  summaries, research, writing help, task management, and conversation.
- **Company Agents** -- one set per business. Each handles email, calendar, and documents
  for that company. Fully isolated from each other.
- A **Security Overseer** -- an independent process that reviews every action before it
  happens. Not an AI -- a rule-based guard that cannot be instructed or overridden.
- A **System Administrator** -- the AI that manages the infrastructure. You talk to it
  when something needs configuring or something goes wrong.

### What your system does NOT do

- It does not take actions without your approval (no emails sent without a draft review,
  no calendar events created without confirmation unless you set this up explicitly)
- It does not trade, transfer money, or make financial commitments automatically
- It is not connected to the internet in a way that external services can reach it --
  it calls out, but nothing calls in (except your relay channel)

---

## 2. Hardware Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Mac model | Mac Mini M1 or later | Mac Mini M4 |
| RAM | 8 GB | 16 GB (required for local AI module) |
| Storage | 100 GB free | 256 GB free |
| macOS version | 14.0 (Sonoma) | Latest available |
| Internet | Broadband | Broadband |

**Why a Mac Mini?** The system runs as background services 24 hours a day. A Mac Mini uses
approximately 7-15 watts at idle -- less than a light bulb. A MacBook cannot sleep while
services run, which drains the battery and interrupts availability.

**Can I use a MacBook?** Yes, during setup and testing. For production use, a dedicated
Mac Mini is strongly recommended.

---

## 3. What Will This Cost Me?

Your AI system has two types of cost: a one-time hardware cost and ongoing running costs.

### One-time costs

| Item | Approximate cost |
|------|-----------------|
| Mac Mini M4 (16 GB) | £700 |
| Setup time (self-install) | Free |
| Setup time (assisted install) | Varies |

### Monthly running costs

Running costs come from the AI APIs your system calls. These are pay-per-use -- you pay for
what your agents actually process, not a flat subscription.

| Service | What it is used for | Typical monthly cost |
|---------|--------------------|--------------------|
| Anthropic (Claude) | All AI reasoning and generation | £10-50 |
| Microsoft 365 / Google | Email, calendar, documents | Your existing subscription |
| ElevenLabs (optional) | Voice synthesis for briefings | £0-10 |
| Tailscale | Private network for mobile access | Free (personal plan) |

**Total typical monthly running cost: £10-60 depending on usage volume.**

### Three scenarios

**Scenario A: Single company, light use**  
One company, checking email twice a day, morning briefing, occasional requests.  
Estimated monthly API cost: £10-20.

**Scenario B: Two to three companies, active use**  
Two or three companies, email monitoring, calendar management, daily briefings, frequent
requests throughout the day.  
Estimated monthly API cost: £25-60.

**Scenario C: Heavy use with multiple companies and content generation**  
Three or more companies, active use, trading signals module, content publishing module,
voice briefings.  
Estimated monthly API cost: £60-150.

---

## 4. The Two Thousand Pound Lesson

When AI APIs first became available, it was easy to accidentally run up large bills.
A misconfigured pipeline, a loop, an unintended high-volume operation -- and suddenly
you are looking at a four-figure invoice.

This system has been designed with that lesson built in. Before your agents start running,
the installer walks you through setting spending limits on your Anthropic account. A hard
spending limit means Anthropic stops all API calls once the cap is reached. No surprises.

**You start optimised.** The cost protections are not an afterthought -- they are part of
the installation process. You cannot accidentally skip them.

See the Installation Guide (Manual 2) for the exact steps.

---

## 5. The 24/7 Awareness

Unlike a chatbot you open when you need it, your AI system runs continuously.

This means:
- Your morning briefing is ready when you wake up -- the agent prepared it overnight
- Your email is summarised and prioritised as it arrives
- Your calendar is monitored for upcoming deadlines
- Your Security Overseer is always watching for anomalous activity

It also means you need to keep your Mac running. The system is designed for a dedicated
machine that stays on. If you restart or shut down your Mac, the agents restart automatically
when macOS loads -- no manual steps needed.

---

## 6. Quick-Start Checklist

Before you begin, make sure you have:

- [ ] A Mac meeting the hardware requirements above
- [ ] macOS 14 (Sonoma) or later installed
- [ ] An Anthropic account at console.anthropic.com
- [ ] An Anthropic API key ready to paste
- [ ] Spending limits set (or ready to set during installation)
- [ ] Your Microsoft 365 or Google Workspace login details
- [ ] Azure app registration credentials (for Microsoft 365) or Google Cloud credentials
- [ ] Tailscale account created at tailscale.com (free)
- [ ] Node.js 20 or later installed (run: `brew install node`)
- [ ] Homebrew installed (see brew.sh)

The installer will guide you through each item. You do not need to do all of this before
starting -- the installer will tell you exactly what it needs at each step.

---

## 7. How Your System Stays Secure

Your AI system is designed to run privately. It does not expose itself to the internet.
External access is only possible through Tailscale, your private network.

Key security features:
- **Tenant isolation:** each company's agents run under a separate OS account. They
  cannot access each other's data.
- **Security Overseer:** every action is reviewed before it executes. Unknown actions
  are blocked automatically.
- **Credential scoping:** the mail agent only has access to email. The calendar agent
  only has access to calendar. No agent can do more than its defined role.
- **No inbound connections:** nothing on the internet can connect to your system.
  Your agents call out; nothing calls in.

See the Security Guide (Manual 4) for full details.

---

## 8. Where to Get Help

**Documentation:** All manuals are available in your system's documentation server
(accessible via the Admin Shell or your local browser).

**GitHub:** https://github.com/AI-PandorasBox/pandoras-box  
Open an issue for bugs or feature requests.

**Community discussions:** GitHub Discussions on the same repository.

**Before raising an issue:**
1. Check the Troubleshooting Guide (Manual 8)
2. Check the GitHub Discussions for similar reports
3. Include your macOS version, Node.js version, and the relevant log output

---

## 9. What Comes Next

Once your system is installed and running:

1. **Read Manual 5** -- the Personal Assistant User Manual. This is where most users
   spend the most time. Your Personal Assistant is the part of the system you will
   talk to every day.

2. **Read Manual 6** -- the Company Agents Guide. Understand how your company agents
   work, what they can and cannot do, and how to use the approval flow.

3. **Bookmark your Admin Panel.** The Admin Panel (accessible via Tailscale) lets you
   check service status, restart agents, and monitor the job queue from your phone.

4. **Set up your relay.** Your agents communicate through a relay channel -- this might
   be Telegram, Discord, or Slack depending on your preference. The installation guide
   covers setting this up.
