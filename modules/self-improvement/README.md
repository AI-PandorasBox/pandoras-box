# self-improvement

> **Agent Self-Improvement Pipeline**

**Status:** Optional
**Depends on:** core, personal-ai

## What It Does

Agent self-improvement pipeline using GEPA (Generalised Error-driven Prompt Adjustment)
and a skill library.

the Self-Improvement Pipeline analyses agent performance logs weekly, identifies patterns in successful and
unsuccessful interactions, and generates prompt adjustments. Adjustments are applied on
the next cycle after review.

Over time, your agents become more accurate and relevant to your specific use cases.

## Schedule

- GEPA optimisation: Saturday 22:00
- Sunday review: Sunday 08:00
- Skill review interval: 72 hours

## Monthly Cost

Zero API cost for the GEPA optimiser (deterministic heuristics, no LLM calls).
Other passes in this module may invoke the LLM in future versions; none do today.

## GEPA optimiser

GEPA = Generated Edit Proposals, Aggregated. Runs alongside the legacy
weekly review on the Sunday cron.

**Inputs**

The optimiser reads the Personal AI module's session log:

```
${INSTALL_PATH}/personal-ai/store/sessions/YYYY-MM-DD.jsonl
```

One JSONL file per day. Each line:

```json
{"ts":"...","conversation_id":"abc","role":"assistant","content":"...","rating":2,"regenerated":false,"corrected":false}
```

If the directory is missing or empty, the digest will say so and exit cleanly.

**What it detects**

- **Rejected:** assistant turns where `rating != null && rating < 3`
- **Regenerated:** assistant turns where `regenerated === true`
- **Corrected:** assistant turns where `corrected === true` (the next
  operator turn is captured as the correction text)

For each candidate the digest quotes the preceding user turn, the
assistant's response, and (for corrections) the operator's follow-up.
A deterministic suggestion is added per kind. No LLM is called.

**Output**

```
${INSTALL_PATH}/self-improvement/output/weekly-YYYY-MM-DD.md
```

**Operator-gated**

The digest writes a markdown file. It does NOT modify any prompt. It does
NOT touch the personal-ai module. To adopt a proposed edit, copy the
suggested text into your own prompt source under
`${INSTALL_PATH}/personal-ai/prompts/` (or follow your repo's
prompt-management workflow).

**Testing locally**

```
PBOX_SESSIONS_DIR=/tmp/test-sessions \
PBOX_GEPA_OUT_DIR=/tmp/test-out \
node modules/self-improvement/runtime/gepa-optimiser.mjs
```

## How to Install

```
sudo bash modules/self-improvement/install.sh
```

## Uninstall

```
sudo launchctl stop com.pandoras-box.self-improvement-gepa
sudo launchctl stop com.pandoras-box.self-improvement-review
```

Remove `SELF_IMPROVEMENT_ENABLED=true` from `/opt/pandoras-box/self-improvement/.env`.
