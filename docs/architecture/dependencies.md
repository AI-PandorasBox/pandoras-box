# Service Dependencies and Blast Radius

<!-- _A4_ARCHITECTURE_DOCS_V1 -->

> What happens when something breaks. Which services depend on what. How to think about cascading failures across the system.

## 1. Why this matters

Pandora's Box runs ~25 daemons on a single Mac. Each has dependencies on others. If a foundational service degrades, many things downstream stop working. Operators benefit from knowing the blast radius before something fails, not after.

## 2. The dependency map (concise)

```
                                  Anthropic API (external)
                                          │
                                          ▼
                                       Bridge
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
        Argus                  Layer-3 conductors           Layer-4 peer agents
            │                             │                             │
            ▼                             ▼                             ▼
       (oversight)            Layer-5 task agents              (Personal AI etc.)
                                          │
                                          ▼
                              MS365 MCP / ElevenLabs /
                              Google AI / Brave / etc.
                                          │
                                          ▼
                           External provider APIs / Tailscale
```

Plus orthogonal dependencies:

- **mnemosyne (Personal AI's memory daemon)** — reads from + writes to the shared SQLite memory DB. All agents that consult shared memory depend on it.
- **Kiwix** (when the Offline Knowledge Library module installed) — local offline knowledge base.
- **Docker** (when the Offline Knowledge Library installed) — hosts the Kiwix container.

## 3. Blast radius by service

| Service breaks → | What stops |
|---|---|
| **Bridge** | Every Claude call across every agent. System effectively offline for LLM-driven work. Cached / pre-computed responses still serve. |
| **Argus** | Job queue stops processing new jobs. Currently-running jobs complete. **New work stalls.** |
| **mnemosyne (Personal AI memory daemon)** | Personal AI offline. All cross-tenant memory reads fail. Business agents that consult shared memory degrade to "no memory" mode. |
| **MS365 MCP** | Mail / Calendar / Files modules for affected tenants stop. Each tenant has its own MCP subprocess; one tenant failure doesn't affect others. |
| **A Layer-3 conductor** | One tenant's agent stops dispatching. Its Layer-5 task agents become unreachable through that conductor (they're alive but idle). |
| **A Layer-5 task agent** | One module of one tenant stops. Others continue. |
| **the Content Classifier** | Outbound content classification stops. If light-gate is active, blocking falls open (configurable: fail-closed or fail-open per tenant). |
| **Kairos panel** | Loss of admin visibility into temporal recall. Actual recall continues uninterrupted (Kairos scoring runs inside mnemosyne; panel is read-only surface). |
| **Tailscale (when used for mobile)** | Phone / mobile devices lose connectivity to the Personal AI. LAN-side access continues. |
| **External provider API (Anthropic / Google / ElevenLabs / etc.)** | The functionality bound to that provider stops. Others continue. Operator should monitor provider status pages. |

## 4. Recovery cheat-sheet (per service)

Quick "what to do" — see `recovery.md` for full procedures.

| Service | If it fails, run |
|---|---|
| Any system LaunchDaemon | `sudo launchctl stop com.pandoras-box.<service>; sudo launchctl start com.pandoras-box.<service>` |
| Bridge | The bridge restarts on the next chat session boot. If stuck, restart mnemosyne. |
| MS365 token expired | Re-run the installer's MS365 step for the affected tenant. |
| ElevenLabs auth fails | Check keychain entry: `security find-generic-password -s ELEVENLABS_API_KEY`. Re-run setup. |
| Tailscale | Open Tailscale app; sign in if needed; verify Mac shows as connected. |

## 5. Independent dependency layers

The system is built to fail gracefully in layers — operators can use core functionality even if optional add-ons are degraded.

- **Bridge healthy + Argus healthy** = core works. Every other dependency can fail without taking the system offline.
- **mnemosyne healthy** = Personal AI works. Business tenants still operate without it.
- **Each tenant healthy independently** = one tenant's broken integration doesn't affect another.

Architectural invariants:

1. No tenant can read another tenant's data even when both are running on the same Mac.
2. The admin agent never holds a tenant's credentials directly — task agents do.
3. Argus is independent of every agent it watches — an agent cannot disable its own oversight.

## 6. Daemon roster by layer

(See [Architecture Layer Model](layers.md) for the full layer-by-layer subsystem list.)

| Layer | Service accounts in default install |
|---|---|
| 0 | operator (the operator's own login account) |
| 1 | argus, content-classifier |
| 2 | shared (no UID — files only), self-improvement, media-production, offline-kb |
| 3 | one per tenant (`tenant-1-agent`, `tenant-2-agent`, …) |
| 4 | mnemosyne (Personal AI), trading-research (if installed) |
| 5 | per tenant, per module — sub-process under the tenant's UID |

## 7. Logs to check first when something is wrong

```
/tmp/pandoras-box-<service-name>.log    # primary log per service
/var/ai-audit/audit.log                 # Argus audit trail
journalctl-equivalent: log show         # system log (rarely needed)
```

The `mnemosyne` daemon also writes structured logs to its own store, viewable in the Personal AI UI's Admin tab.

## Reference

- [Architecture Layer Model](layers.md)
- [Recovery runbook](recovery.md)
- [Multi-tenant isolation](../multi-tenant.md)
- [Setup — MS365](../setup/ms365.md)
- [Setup — Tailscale](../setup/tailscale.md)
