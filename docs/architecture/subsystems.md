# Subsystems — Memory, Security, and Self-Improvement

<!-- _SUBSYSTEMS_EXPLAINER_V1 -->

The dashboard and architecture overview show *where* each subsystem sits (see [`layers.md`](layers.md)). This document explains *what each one does and how it works* — the three families operators ask about most: how the system **remembers**, how it **protects itself**, and how it **gets better over time**.

All names below are the shipped defaults.

---

## Security

Two independent Layer-1 daemons guard the whole system. Neither can be instructed by an agent — they sit *above* the agents and judge their work.

### Argus — the Security Overseer
Argus reviews **every job before it executes**. The flow is: an agent (or conductor) writes an action to the central job queue → Argus inspects it → **approves or blocks** it → only then does a task agent run it. Nothing bypasses the queue, so every action is auditable.

How it decides:
- **Per-job screening** — each queued job is classified (using the Content Classifier, below). Jobs that look anomalous, that touch out-of-policy paths, or that fail safety classification are blocked.
- **Per-source strike quarantine** — a source that produces repeated bad jobs is quarantined after N strikes, so one compromised or misbehaving input can't flood the system.
- **Weekly dependency + integrity scan** — once a week Argus runs a dependency/`npm audit` pass over the install and checks a file-integrity baseline of high-value files (service code, plists, config). Drift or a known-vulnerable dependency is surfaced as a pending mitigation for the operator to approve.
- **Fail-closed** — if Argus itself is unavailable, jobs do not execute. The safe default is "don't run", not "run unchecked".

### The Content Classifier (Cerberus)
A lightweight, local content-safety classifier that screens **outbound** content across six axes: prompt safety, response safety, response refusal, prompt toxicity, response toxicity, and jailbreak detection. It runs on-device (no content leaves the machine) and ships in **shadow mode** — it observes and records what it *would* have flagged for a calibration period before it ever blocks anything, so you can see its judgement before trusting it. Argus consumes its verdicts when screening jobs.

---

## Memory

Memory is **layered** — different layers answer different questions ("what was just said?", "what's relevant to this?", "how do these facts connect?", "what's still true?"). Together they let agents recall the right context without re-reading everything.

| Layer | What it holds | How it works |
|---|---|---|
| **Working memory store** | Structured facts, entities, threads, and session transcripts | A local SQLite store the agents read and write each turn. The source of truth for "what happened." |
| **Semantic recall** (`vector-kb`) | Embeddings of past content | Text is embedded locally (Ollama) into vectors; a query is embedded the same way and the nearest neighbours are returned — so the agent recalls *relevant* past context, not just recent. |
| **Knowledge vault** (`vault-graph`) | Entities + relationships, as a browsable graph | Renders the memory store into a linked Markdown vault (Obsidian-compatible) — facts, threads, and the relationships between people/things — so memory is inspectable, not a black box. |
| **Consolidation + aging** | Durable, de-duplicated long-term memory | A periodic "consolidation" pass (the sleep/dreams pattern): it reads the raw memory store as an *immutable* input, writes a separate consolidated output, and attaches validity windows so stale facts age out instead of lingering forever. |
| **Recall scoring** | A relevance/recency score per memory | Scores each memory so recall surfaces the most useful items first, and so consolidation knows what to keep, age, or drop. It is the *scoring* engine; consolidation is the *aging* engine that acts on those scores. |

The practical effect: an agent can be asked "what did we decide about X last month?" and get a precise answer assembled from the right layer, rather than a guess.

---

## Self-Improvement

The **Self-Improvement Pipeline** (Layer 2) is how agents get better over time without manual prompt-engineering. It runs as a set of scheduled sub-processes, each with a narrow job, and — importantly — every proposed change is **graded and gated** before it ships.

| Sub-process | Schedule | What it does |
|---|---|---|
| **GEPA cycle** | Weekly | Reviews the week's agent traces and proposes targeted improvements to tool descriptions and system prompts. Proposals are candidates, not changes. |
| **The grader** | After GEPA | Grades each proposed candidate against a rubric, in a **separate** model context from the agent that would benefit — so the judge isn't the author. Returns per-criterion pass/fail + scores. |
| **Reflexion** | Hourly | Scans the operation + oversight logs for threshold breaches and proposes small, targeted fixes between the weekly cycles. |
| **Memory consolidation** | Weekly | The "dreams" pass described under Memory — consolidates and ages accumulated memory. |
| **Upstream scanner** | Weekly | Watches upstream model and dependency changes so the system can react to things that affect it. |
| **Operator digest** | Weekly | A plain-English summary of what shipped this week and what was blocked. |

### The grader: shadow → binding
The grader is the safety mechanism that lets agents self-modify without a human reviewing every change. It runs in two stages:

1. **Shadow** — it grades proposed changes but **blocks nothing**. Its verdicts are recorded and compared against the operator's own accept/reject decisions. This calibration period proves the grader's judgement matches yours.
2. **Binding** — once the grader's verdicts match operator decisions to a high threshold over a sustained window, it becomes binding: a failing grade **blocks** the change from shipping, with the oversight daemon (Argus) as a final gate. The operator retains rollback.

Until a change clears the grader (and, once binding, Argus), it does not reach a running agent. That is what makes autonomous self-improvement safe: nothing the system proposes about itself ships unjudged.

---

## See also
- [`layers.md`](layers.md) — which layer each subsystem belongs to
- [`governance-and-integrity.md`](governance-and-integrity.md) — the integrity + approval model
- [`../operations/operator-workflow.md`](../operations/operator-workflow.md) — the deploy gate the above depends on
