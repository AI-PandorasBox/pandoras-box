<!-- Thanks for contributing to Pandora's Box. Fill this in so review is quick. -->

## What does this PR do?



## Type
- [ ] New module (`modules/<name>/`)
- [ ] New skill (`modules/skills-library/skills/<name>/`)
- [ ] Fix / improvement to an existing module
- [ ] Docs / other

## New module / skill checklist (delete if not applicable)
- [ ] `module.json` present and valid (`node scripts/validate-modules.mjs` passes)
- [ ] `README.md` + `install.sh` present; `install.sh` is idempotent and prints `[<name>] PASS/FAIL`
- [ ] Ports declared in `module.json` and do not collide with existing modules
- [ ] Service user stated; daemon runs as that user, not root
- [ ] No **new `sudo`** rules (or they are listed and justified below)
- [ ] No secrets committed; secrets are collected from the operator at install time
- [ ] Uninstall path provided (`uninstall.sh` or documented)
- [ ] `requires` declares any modules/surfaces it depends on

## Security notes (new ports / daemons / sudo / network egress)



## How was this tested?

