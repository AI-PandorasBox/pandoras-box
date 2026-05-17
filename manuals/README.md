<!-- _A6_1_NARRATIVE_SCRUB_V1 -->
# Pandoras Box -- User Manuals

The Pandoras Box documentation suite is available as formatted PDFs, downloadable from each GitHub release.

## Download PDFs

All manuals are available individually or as a bundle from the [latest release](https://github.com/AI-PandorasBox/pandoras-box/releases/latest).

| Manual | Description |
|--------|-------------|
| [Getting Started](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-getting-started.pdf) | System overview, hardware requirements, cost scenarios, quick-start checklist |
| [Installation Guide](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-installation.pdf) | Full step-by-step installation: Tailscale, certificates, API keys, company setup |
| [System Administrator Guide](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-admin-guide.pdf) | Service management, monitoring, job queue, projects, deploy flow |
| [Security Guide](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-security.pdf) | Isolation model, Argus design, threat model, incident response |
| [Personal Assistant User Manual](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-personal-assistant.pdf) | Personal AI features: briefings, inbox, research, voice, memory, self-improvement |
| [Company Agents Guide](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-company-agents.pdf) | Mail, Calendar, Files agents, approval flow, multi-tenant, AaaS |
| [Module Reference](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-module-reference.pdf) | All 20 modules with prerequisites, costs, and UI detail |
| [Troubleshooting Guide](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-troubleshooting.pdf) | Symptom, cause, and fix for the most common issues |
| [All Manuals (ZIP)](https://github.com/AI-PandorasBox/pandoras-box/releases/latest/download/pandoras-box-all-manuals-v0.1.0.zip) | All 8 PDFs in a single bundle |

SHA256 checksums for all assets are listed in each release.

---

## Markdown Source

The markdown source files for all manuals are in this directory:

| File | Manual |
|------|--------|
| `01-getting-started.md` | Getting Started |
| `02-installation.md` | Installation Guide |
| `03-admin-guide.md` | System Administrator Guide |
| `04-security.md` | Security Guide |
| `05-personal-ai-user-manual.md` | Personal Assistant User Manual |
| `06-company-agents.md` | Company Agents Guide |
| `07-module-reference.md` | Module Reference |
| `08-troubleshooting.md` | Troubleshooting Guide |

---

## Generating PDFs Locally

PDFs are generated from the markdown source using headless Chrome. No npm dependencies required.

```bash
# From the repo root
node manuals/generate-manuals-pdf.mjs
```

Output: `manuals/pdfs/*.pdf` and `manuals/pdfs/pandoras-box-all-manuals.zip`

**Prerequisites:** Google Chrome installed at `/Applications/Google Chrome.app`
