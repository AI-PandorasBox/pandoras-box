# Module Specification

A Pandora's Box **module** is a self-contained capability an operator can add to
their install. This document is the contract every module follows. New modules
are contributed as GitHub pull requests (see [CONTRIBUTING.md](../CONTRIBUTING.md));
CI validates them against this spec, a maintainer reviews, and on merge the module
is listed in [`registry.json`](./registry.json) with a tier.

## Directory layout

```
modules/<name>/
  module.json        # REQUIRED for new modules — machine-readable manifest (see below)
  README.md          # REQUIRED — what it does, what it needs, costs
  install.sh         # REQUIRED — idempotent installer (contract below)
  uninstall.sh       # recommended — clean removal
  requirements.md    # optional — prerequisites / third-party accounts / costs
  runtime/           # service modules only — the code + a *.plist.template
    <name>.mjs
    com.pandoras-box.<name>.plist.template
```

`<name>` is lower-kebab-case, unique across `modules/`.

## `module.json`

```jsonc
{
  "name": "offline-kb",                 // REQUIRED, matches the dir name
  "version": "1.0.0",                   // REQUIRED, semver
  "description": "Local vector knowledge base.",  // REQUIRED, one line
  "kind": "service",                    // REQUIRED: "service" | "config" | "skill-pack" | "library"
  "ports": [8489],                      // service modules: ports it binds (must be unique across all modules)
  "service_user": "pbox-<name>",        // optional, the account the daemon runs as
  "launchdaemon_label": "${PREFIX}.offline-kb", // service modules: the launchd label
  "requires": ["surface:web-browser"],  // optional: other modules / surfaces / principal_types it needs
  "cost_estimate": "free (local)",      // optional, plain English
  "uninstall": "uninstall.sh",          // optional: how it is removed
  "author": "AI-PandorasBox"            // optional
}
```

- `kind: "service"` modules MUST ship `runtime/<name>.mjs` and a `*.plist.template`, and SHOULD declare `ports` + `launchdaemon_label`.
- `kind: "config"` modules configure an existing agent/conductor capability and need no daemon.
- `kind: "skill-pack"` modules add skills (see `skills-library` and `SKILL.md`).
- `kind: "library"` modules are no-daemon code libraries imported by other components (e.g. the fleet skill-sync verifier); they ship their code under `runtime/` but have no `*.plist.template`, ports, or daemon.
- `requires` entries are typed: `module:<name>`, `surface:<name>`, `principal_type:<name>`.

## `install.sh` contract

- Idempotent — safe to re-run.
- Reads `theme.conf` / env for `INSTALL_PATH`, `LAUNCHDAEMON_PREFIX`, etc.; never hardcodes them.
- Service modules: render the plist template, `plutil -lint` it, load it, then **curl the port and assert a response** before declaring success.
- Prints a final `[<name>] PASS` or `[<name>] FAIL: <reason>`.
- No secrets in the repo; secrets come from the operator at install time.
- Any new `sudo` rule, port, or LaunchDaemon is declared in `module.json` and called out in the PR (CI flags them for the reviewer).

## Validation

`node scripts/validate-modules.mjs` (run in CI by `.github/workflows/module-validate.yml`):

1. every `modules/*/` has `install.sh` + `README.md`;
2. `module.json`, where present, matches this spec (required fields, types, kind-specific files);
3. no two modules declare the same port;
4. advisory: new `sudo` / ports / LaunchDaemon labels are reported for reviewer attention.

## Tiers (set by maintainers in `registry.json`, not by contributors)

| tier | meaning |
|------|---------|
| `core` | ships and runs by default; maintained by the project |
| `official` | maintained by the project, opt-in |
| `community-vetted` | contributed, reviewed + merged, safe to install |
| `experimental` | contributed, merged for visibility, use at your own risk |

## Scaffolding a new module

```
bash scripts/add-module.sh my-module --kind service --port 8490
```

This creates `modules/my-module/` pre-filled from this spec. Edit, run the validator,
open a PR.
