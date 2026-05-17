# Company Agents Guide

**Version:** 1.0  
**Audience:** Business owners and operators using company-specific AI agents

---

## Disclaimer

This software is provided under the MIT License on an "as-is" basis, without warranty.
AI responses are not professional advice. You are responsible for reviewing all AI-generated
drafts before they are sent. You are responsible for your API costs and credential security.

---

## 1. What Is a Company Agent?

A Company Agent is a set of AI agents dedicated to one company. Each company you connect
gets its own isolated agent set -- completely separate from every other company in the system.

A Company Agent consists of:

- **The Conductor:** receives your messages and routes them to the right specialist agent
- **The Mail Agent:** reads, summarises, drafts, and sends email
- **The Calendar Agent:** reads, creates, and manages calendar events
- **The Files Agent:** accesses documents in SharePoint or Google Drive
- **The Voice Agent:** handles voice synthesis for spoken notifications (optional)

These agents work together as a team. When you ask a company agent to prepare for a
meeting, it may pull in the calendar agent to check the meeting details, the mail agent
to summarise recent correspondence with attendees, and the files agent to retrieve
relevant documents.

---

## 2. The Conductor

The Conductor is the front door for each company. It is the agent you talk to directly.

When you send a message to a company's relay channel, the Conductor:
1. Reads and understands your request
2. Decides which specialist agent (mail, calendar, files) should handle it
3. Writes a job to the queue
4. Waits for the Security Overseer to approve the job
5. Hands the approved job to the right agent
6. Returns the result to you

The Conductor holds no company credentials. It cannot access email, calendar, or documents
directly. It only routes. This is a security design: even if the routing logic is
compromised, there are no credentials to steal at the conductor level.

---

## 3. The Mail Agent

The Mail Agent handles email for one company. It has access to that company's email account
and nothing else.

### What you can ask

- "What emails need attention today?"
- "Summarise the thread with [person]"
- "Draft a reply to [specific email] -- agree to the proposal, ask for a timeline"
- "What did [person] say about [topic] in their last email?"
- "Flag any emails from unknown senders today"
- "Are there any emails from [domain] in the last two weeks?"

### The draft approval flow

When you ask the Mail Agent to reply to an email, it prepares a draft. The draft is
presented to you for review. You can:
- Approve it as written: "Send it"
- Ask for changes: "Make the tone warmer" / "Shorten this to two paragraphs"
- Reject it: "Don't send this -- I'll handle it myself"

Nothing is sent until you say so.

### Email monitoring

Your Mail Agent checks for new email on a schedule (default: 08:00, 13:00, 18:00).
Urgent emails (based on sender, subject keywords, and threading) are flagged in your
morning briefing or sent as immediate alerts if you have configured this.

### Microsoft Outlook and Gmail

Both are supported and treated identically. The agent handles the difference in underlying
APIs transparently. You interact the same way regardless of which email provider the
company uses.

---

## 4. The Calendar Agent

The Calendar Agent reads and writes to your company calendar. It has access to one
company's calendar and nothing else.

### What you can ask

- "What meetings do I have this week for [company]?"
- "What is my schedule tomorrow?"
- "Find a free slot for a 45-minute call next week, morning preferred"
- "Create a meeting with [contact] on Thursday at 14:00 -- send the invite"
- "Reschedule my 3pm tomorrow to Friday -- propose 10am or 2pm"
- "What prep do I need for today's meetings?"
- "Block out Friday afternoon for focused work"

### Meeting briefs

The Calendar Agent can work with the Mail Agent to produce meeting briefs. If you have
a meeting with an existing contact, ask:

"Brief me for my 11am meeting."

The response will include meeting details, relevant correspondence history, open threads,
and any documents referenced in recent emails.

### Invite management

When you receive a meeting invite:
- The Calendar Agent can summarise it and ask whether to accept, decline, or propose a
  different time
- You confirm the action before anything is sent

### Outlook Calendar and Google Calendar

Both are supported. If a company uses Microsoft 365 for email and Google Calendar for
scheduling (unusual but possible), you can configure both. The agent handles the
combination.

---

## 5. The Files Agent

The Files Agent accesses documents stored in SharePoint (Microsoft 365) or Google Drive.
It has read and write access to the documents the company's account can access.

### What you can ask

- "Find the latest version of the marketing proposal"
- "Summarise the board minutes from last month"
- "What does the contract with [client] say about payment terms?"
- "List all documents shared with [person]"
- "Create a new document for the Q3 report -- I will dictate the structure"
- "Save this summary as a new document in the [folder] folder"

### Document access

The Files Agent can only access documents that the connected service account can access.
It cannot access documents that require different permissions.

**SharePoint (Microsoft 365):** the agent accesses SharePoint sites and document libraries
linked to the company's Microsoft 365 account.

**Google Drive (Google Workspace):** the agent accesses documents in the company's
Google Drive, including shared drives.

### What it does NOT do

The Files Agent does not delete documents. It reads, creates, and edits. Deletion
requires explicit confirmation and is not available in the default configuration.

---

## 6. Multi-Tenant Operation

If you have connected multiple companies, each operates in complete isolation.

When you talk to a company's relay channel, only that company's agents respond.
The Mail Agent for Company A has no access to Company B's email, and vice versa.

The Security Overseer enforces this at the infrastructure level -- it is not just
a policy, it is a structural constraint enforced by the OS.

### Keeping companies separate

Each company has:
- Its own relay channel (separate Telegram bot, Discord server, or Slack workspace)
- Its own service account on the Mac
- Its own credential files, accessible only to its service account
- Its own section of the job queue

Your Personal Assistant, however, can view across all companies -- because it works
for you, not for a single company. You can ask your Personal Assistant for a
cross-company view: "What needs attention across all my businesses today?"

---

## 7. The Approval Flow in Practice

Every action goes through this sequence:

```
Your message
    -> Conductor routes to queue
        -> Security Overseer reviews (automatic, ~60 seconds)
            -> Task agent executes (if approved)
                -> Result returned to you
```

For most actions, this happens in seconds and is invisible. You send a message, you get
a response.

For actions with external effects (sending an email, creating a calendar event, writing
a document), there is an additional approval step: the agent shows you what it is about
to do and waits for your confirmation.

This means:
- No email is sent without you seeing the draft first
- No calendar event is created without you confirming the details
- No document is modified without you reviewing the proposed change

---

## 8. AaaS: Agents as a Service

If you are a service provider, you may be running company agents for clients as a
managed service. In this model:

- You provision a new company agent for each client using `add-tenant.sh`
- Each client gets their own isolated environment -- no data crosses between clients
- You manage the infrastructure; the client interacts with their company agent
- Billing for API usage is your responsibility to pass through or absorb

The service provider setup path in the installer includes tools for this:
- Client onboarding script (automated provisioning)
- Welcome pack template (what to send new clients)
- Pricing template (suggested tier structure)

See the System Administrator Guide (Manual 3) for the multi-tenant management commands.
