<!-- _A6_1_NARRATIVE_SCRUB_V1 -->
# DISCLAIMER FRAMEWORK -- Pandoras Box Open Source Release

**Status:** Design spec -- Phase 1 outputs disclaimers into LICENSE, README, SECURITY.md, and every manual.
**Date:** 2026-04-19

---

## Where disclaimers appear

| Location | Type | Tone |
|----------|------|------|
| LICENSE (MIT) | Software warranty disclaimer | Formal legal |
| README.md | Quick "use at your own risk" summary | Plain English |
| SECURITY.md | Security and deployment responsibility | Direct |
| Every manual -- first page | Full disclaimer block | Clear and accessible |
| Installation manual -- dedicated section | Extended disclaimer covering AI, APIs, costs | Detailed |
| Module reference -- per AI/API module | Module-specific liability | Specific |

---

## 1. Software Disclaimer (MIT LICENSE -- standard)

The MIT License already contains the standard warranty disclaimer:

> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

This applies to the software itself. Additional disclaimers cover AI outputs, API costs, and data.

---

## 2. General Disclaimer (README and manual front page)

```
DISCLAIMER -- PLEASE READ BEFORE INSTALLING

Pandoras Box is open-source software provided free of charge, as-is, with no warranties
of any kind. By installing or using this software, you accept full responsibility for:

  - Any actions taken by AI agents running on your system
  - Any costs incurred through third-party APIs (Anthropic, ElevenLabs, Microsoft, Google,
    and any other services you connect)
  - Any data processed, stored, or transmitted by the system
  - The security of your installation and the devices connected to it
  - Compliance with any laws or regulations applicable to your use case

The creators and contributors of Pandoras Box accept no liability for any direct, indirect,
incidental, or consequential damages arising from the use of this software.

USE AT YOUR OWN RISK.
```

---

## 3. AI Output Disclaimer

Appears in: README, Getting Started manual, Company Agent manual, Personal AI manual.

```
AI OUTPUTS

This software uses large language models (including Claude by Anthropic) to generate
responses, draft communications, and take actions on your behalf.

AI systems can and do make mistakes. They may:
  - Generate incorrect, incomplete, or misleading information
  - Draft emails or messages that do not accurately represent your intent
  - Make decisions based on misunderstood instructions

YOU ARE RESPONSIBLE FOR REVIEWING ALL AI-GENERATED OUTPUTS BEFORE THEY ARE SENT OR
ACTED UPON. The system is designed to require human approval for outbound communications,
but you remain solely responsible for anything sent from your accounts.

Do not rely on AI outputs for legal, financial, medical, or safety-critical decisions
without independent verification.
```

---

## 4. API Cost Disclaimer

Appears in: Installation manual, Module Reference (per AI/API module), Getting Started.

```
THIRD-PARTY API COSTS

Pandoras Box connects to third-party services that charge based on usage. These include
but are not limited to:

  - Claude (Anthropic): billed as a flat Claude Pro or Max subscription. Manage your plan
    at claude.ai. API-key (pay-per-token) billing is not supported in this release.
  - ElevenLabs API: charged per character of text converted to speech. Monitor at
    elevenlabs.io.
  - Microsoft 365: subject to your existing Microsoft licence. Graph API usage is included
    with M365 licences but subject to rate limits.
  - Google Workspace APIs: subject to your existing Google Workspace licence and quota limits.
  - Any other third-party service you connect during installation.

THE AUTHORS OF PANDORAS BOX ACCEPT NO RESPONSIBILITY FOR API COSTS INCURRED DURING USE.
It is your responsibility to:
  - Set spending limits with each API provider
  - Monitor your usage regularly
  - Disconnect modules you are not actively using to avoid unnecessary charges

Large language model costs can accumulate quickly if agents run continuously at high
volume. Review your API provider dashboards regularly, especially in the first week after
installation.
```

---

## 5. Security and Data Disclaimer

Appears in: Security manual, Installation manual.

```
SECURITY AND DATA RESPONSIBILITY

Pandoras Box is designed with security as a core principle. However:

  - The security of your installation depends on correct configuration, regular updates,
    and the security of your network and devices.
  - The authors cannot guarantee that this software is free from security vulnerabilities.
  - You are responsible for keeping your system updated, your API keys secure, and your
    Tailscale network properly configured.
  - Data processed by this system -- including emails, calendar events, and documents --
    passes through third-party AI APIs. Review the privacy policies of each API provider
    you connect, particularly regarding data retention and training.
  - Do not use this system to process data that requires specific compliance (HIPAA, PCI-DSS,
    FCA-regulated activities, etc.) without ensuring the entire stack meets those requirements.
  - The authors accept no liability for data breaches, unauthorised access, or data loss
    resulting from use of this software.

If you discover a security vulnerability in Pandoras Box, please report it via the
responsible disclosure process in SECURITY.md. Do not report vulnerabilities publicly
before the authors have had a chance to address them.
```

---

## 6. No Endorsement Disclaimer

Appears in: README, module documentation.

```
THIRD-PARTY SERVICES

References to third-party services (Microsoft, Google, Anthropic, ElevenLabs, Tailscale,
Discord, Slack, and others) are for informational purposes only. Pandoras Box is not
affiliated with, endorsed by, or officially supported by any of these organisations.

Trademarks belong to their respective owners. Availability, pricing, and terms of
third-party services are subject to change without notice.
```

---

## 7. Compliance Disclaimer

Appears in: Installation manual, Security manual.

```
COMPLIANCE AND LEGAL USE

It is your sole responsibility to ensure that your use of this software complies with:
  - All applicable laws and regulations in your jurisdiction
  - The terms of service of any third-party APIs or platforms you connect
  - Any data protection regulations applicable to the data you process (including UK GDPR,
    EU GDPR, CCPA, or others)
  - Any professional or industry regulations applicable to your use case

The authors of Pandoras Box are not responsible for any legal, regulatory, or compliance
consequences arising from your use of this software.
```

---

## 8. Implementation Instructions for Phase 1 (task_002) and Phase 2b

### In README.md:
Add a "Disclaimer" section near the top (after the quick description, before features). Include: General disclaimer (abbreviated to 3 sentences) + link to full disclaimer in LICENSE and manuals.

### In SECURITY.md:
Add full Security and Data disclaimer block.

### In every manual -- front matter page (before table of contents):
Include full General disclaimer + AI Output disclaimer + API Cost disclaimer. Formatted as a clearly marked box or section. Not buried in appendix -- visible before the user reads any instructions.

### In Installation manual -- dedicated chapter:
Full chapter titled "Before You Begin -- Understanding the Risks". Contains all 7 disclaimer sections in full, in plain English. This is the longest and most important disclaimer location.

### In Module Reference:
Per-module disclaimer where relevant:
- AI modules (any module using Claude API): AI Output disclaimer
- API-cost modules (ElevenLabs, MS365, Google, etc.): API Cost disclaimer
- Security-related modules (e.g. the oversight daemon): Security note

### Tone guidance:
Disclaimers must be clear and plain English -- not buried in legalese that people skip.
The goal is that a non-technical user reads and genuinely understands what they are accepting.
Use numbered lists and short sentences. Avoid all-caps except for the most important lines.
