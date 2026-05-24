# Governance and integrity

How capabilities are gated per agent, how changes are gated before they ship, and
how the code you install can be verified as authentic. These are cross-cutting
concerns that sit alongside the [layer model](layers.md).

---

## 1. Activation matrix (per-agent capability gating)

Every capability an agent can use is explicitly listed in a per-agent **activation
matrix**. It is the single knob for turning a capability on or off for one agent.

Each agent entry declares which of these are active:

| Field | What it gates |
|-------|---------------|
| `modules_active` | installable modules the agent uses (mail, calendar, files, ...) |
| `subsystem_handles_exposed` | shared subsystems the agent may call |
| `skills_active` | skill primitives the agent may invoke |
| `rules_active` / `policies_active` | behavioural rules + safety/rate policies |
| `surfaces_active` | how the agent is reached (web, chat relay, voice, browser) |
| `stores_active` | data stores the agent may read/write |

Dependencies are expressed with `requires` maps: a module or subsystem can declare
that it needs a surface, another module, or a `principal_type` to be present. The
dashboard greys out an "Activate" control when a requirement is unmet.

**Rules of the matrix:**

- It is written by the admin deploy flow **only**. Runtime UI clicks queue a
  request; they never write the matrix directly. The conductor validates the
  schema (atomic write) on read.
- A new capability is invisible to the operator and to the dashboard until it has
  a matrix entry. Shipping a capability and its matrix entry in the same change is
  mandatory.

A worked template lives at [`config/agent-activation.template.json`](../../config/agent-activation.template.json)
with two illustrative agents (a personal assistant and a company agent).

---

## 2. Definition of Done (change gate)

Changes are gated by a **Definition-of-Done checklist** before they go live. The
checklist codifies every surface a change *might* need to touch — module install,
activation matrix, internal docs, public repo, signing — and is evaluated per
change. Each item is either addressed or explicitly marked not-applicable with a
reason.

The point is to make omissions explicit instead of silent: a change that adds a
skill but forgets the activation entry, or ships an installable component without
updating the installer or the changelog, is caught by the gate rather than
discovered weeks later. Public-shippable changes additionally get an explicit
"does this propagate to the public repo?" verdict, so internal-only and
public-facing changes are distinguished deliberately.

---

## 3. Integrity: signing + verification

Two layers of signing let you trust what you install.

**Commits and tags** in this repository are SSH-signed and show GitHub's
"Verified" badge. Anything destined for this public repository also passes an
operator-pattern sanitisation gate first, so operator-specific paths, names, and
credentials never land here.

**Release artifacts** ship a `SHA256SUMS` manifest and a detached `SHA256SUMS.sig`
signature. Verify a download before trusting it:

```
bash scripts/verify-release.sh /path/to/release-dir
```

This checks the signature against `scripts/allowed_signers` (namespace
`pbox-release`) and then the SHA-256 checksums. See
[`RELEASE-SIGNING.md`](../../RELEASE-SIGNING.md) for details.
