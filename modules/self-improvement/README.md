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

Minor Anthropic API usage (weekly batch, not continuous).

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
