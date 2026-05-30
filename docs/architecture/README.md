# Architecture documentation

<!-- _A4_ARCHITECTURE_DOCS_V1 -->

Pandora's Box internal architecture, written for operators who want to understand what runs where and what depends on what.

| Document | When to read it |
|---|---|
| [Architecture overview](overview.md) | First — high-level system description, the agents and their roles |
| [Layer model](layers.md) | When you want the canonical "which layer does this belong to" reference |
| [Key concepts](concepts.md) | Visual explainers — automation→agency, LLM+RAG, defense in depth, model routing |
| [Service dependencies + blast radius](dependencies.md) | Before you change anything — understand what depends on what |
| [Governance + integrity](governance-and-integrity.md) | How capabilities are gated per agent (activation matrix), how changes are gated (Definition of Done), and how to verify signed releases |
| [Recovery runbook](recovery.md) | When something is broken |

Adjacent documentation outside this folder:

- [Multi-tenant isolation](../multi-tenant.md) — how data is kept separate across tenants
- [Module catalogue](../modules.md) — every installable module
- [Security model](../security.md) — overall security architecture
- [Cover page](../cover.md) — long-form project overview
- [Setup guides](../setup/) — one per third-party integration

## Reading order for new operators

1. [Cover page](../cover.md) — what Pandora's Box is and what it does
2. [Architecture overview](overview.md) — how it fits together
3. [Layer model](layers.md) — vocabulary you'll see in dashboards and discussions
4. [Multi-tenant isolation](../multi-tenant.md) — the isolation guarantees
5. [Security model](../security.md) — the threat model
6. [Service dependencies](dependencies.md) — for operational confidence
7. [Recovery runbook](recovery.md) — for when things go wrong

Setup guides are referenced from each capability's section in the cover page and the module catalogue. Read those on a per-need basis.
