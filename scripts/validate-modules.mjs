#!/usr/bin/env node
// validate-modules.mjs -- validates modules/ against modules/MODULE-SPEC.md.
// Pure Node (no deps). Run locally or in CI (.github/workflows/module-validate.yml).
// Exit 1 on hard failures; advisory notes are printed but do not fail the build.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const MODULES = path.join(REPO, 'modules')
const NON_MODULE = new Set(['MODULE-SPEC.md', 'module.schema.json', 'registry.json', 'SKILL-SPEC.md'])

const errors = []
const advisories = []
const portOwner = {}   // port -> module name

function fail(mod, msg) { errors.push(`${mod}: ${msg}`) }
function note(mod, msg) { advisories.push(`${mod}: ${msg}`) }

const entries = fs.readdirSync(MODULES, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort()

for (const name of entries) {
  const dir = path.join(MODULES, name)
  const has = f => fs.existsSync(path.join(dir, f))

  // module.json is the marker of a spec-conformant add-on module. Core runtime
  // components (conductor, core, *-agent, ...) live under modules/ without one
  // and are wired by the main installer, not installed as standalone add-ons --
  // so hard checks apply only to module.json-bearing dirs; the rest are advised.
  if (has('module.json')) {
    if (!has('install.sh')) fail(name, 'missing install.sh')
    if (!has('README.md')) fail(name, 'missing README.md')
    let m
    try { m = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8')) }
    catch (e) { fail(name, `module.json is not valid JSON: ${e.message}`); continue }

    for (const k of ['name', 'version', 'description', 'kind']) {
      if (!(k in m)) fail(name, `module.json missing required field "${k}"`)
    }
    if (m.name && m.name !== name) fail(name, `module.json name "${m.name}" != directory "${name}"`)
    if (m.version && !/^[0-9]+\.[0-9]+\.[0-9]+/.test(m.version)) fail(name, `module.json version "${m.version}" is not semver`)
    if (m.kind && !['service', 'config', 'skill-pack', 'library'].includes(m.kind)) fail(name, `module.json kind "${m.kind}" invalid (service|config|skill-pack|library)`)

    if (m.kind === 'service') {
      if (!has('runtime')) fail(name, 'kind=service but no runtime/ dir')
      else {
        const rt = fs.readdirSync(path.join(dir, 'runtime'))
        if (!rt.some(f => f.endsWith('.plist.template'))) fail(name, 'kind=service but no *.plist.template in runtime/')
      }
    }

    // library: a no-daemon code module imported by other components (no ports/plist).
    // Ships its code under runtime/ but, unlike service, has no *.plist.template.
    if (m.kind === 'library' && !has('runtime')) fail(name, 'kind=library but no runtime/ dir (ship the code there)')

    if (m.ports) {
      if (!Array.isArray(m.ports)) fail(name, 'module.json ports must be an array')
      else for (const p of m.ports) {
        if (!Number.isInteger(p) || p < 1 || p > 65535) fail(name, `module.json port ${p} out of range`)
        else if (portOwner[p]) fail(name, `port ${p} collides with module "${portOwner[p]}"`)
        else portOwner[p] = name
      }
    }

    if (m.requires) for (const r of m.requires) {
      if (!/^(module|surface|principal_type):[a-z0-9-]+$/.test(r)) fail(name, `requires "${r}" must be module:/surface:/principal_type:<id>`)
    }
  } else {
    note(name, 'no module.json yet (required for new modules; existing modules backfilled over time)')
  }

  // 4. advisory: surface security-relevant lines for reviewer attention
  if (has('install.sh')) {
    const sh = fs.readFileSync(path.join(dir, 'install.sh'), 'utf8')
    if (/\bsudo\b/.test(sh)) note(name, 'install.sh uses sudo (reviewer: confirm the rule)')
    if (/LaunchDaemon|launchctl\s+(load|bootstrap)/.test(sh)) note(name, 'install.sh registers a LaunchDaemon (reviewer: confirm label + user)')
  }
}

console.log(`\nmodule-validate: ${entries.length} modules scanned`)
if (advisories.length) {
  console.log(`\nadvisories (${advisories.length}) -- not failing, for reviewer attention:`)
  for (const a of advisories) console.log(`  ~ ${a}`)
}
if (errors.length) {
  console.log(`\nFAILED (${errors.length}):`)
  for (const e of errors) console.log(`  x ${e}`)
  console.log('')
  process.exit(1)
}
console.log('\nPASS -- all modules conform to MODULE-SPEC.md\n')
