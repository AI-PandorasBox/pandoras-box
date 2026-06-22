#!/usr/bin/env node
// skill-governance.mjs — Pbox skill governance layer (NVIDIA Agent-Skills pattern, master-side).
// Provides: ed25519 detached signing + verification, instruction-safety/supply-chain scan,
// skill-card generation, and a single gate() that a skill revision must pass before promotion.
// No external deps (node crypto only). Signing key lives OFF the repo at KEY_DIR (mode 600).
//
// CLI:
//   node skill-governance.mjs keygen
//   node skill-governance.mjs scan   <skillDir>
//   node skill-governance.mjs sign   <skillDir>
//   node skill-governance.mjs verify <skillDir>
//   node skill-governance.mjs card   <skillDir>
//   node skill-governance.mjs gate   <skillDir>     # scan -> (if pass) card + sign -> verdict JSON

import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs'
import { join, relative } from 'node:path'

const KEY_DIR  = process.env.PBOX_SKILL_KEY_DIR || '/opt/pandoras-box/shared/skill-signing'
const PRIV     = join(KEY_DIR, 'pbox-skill-signing.key')   // PEM, mode 600
const PUB      = join(KEY_DIR, 'pbox-skill-signing.pub')   // PEM
const IGNORE   = new Set(['skill.sig', 'skill-card.md', 'scan-report.json', 'metadata.json'])

// ── canonical manifest: sorted "relpath:sha256" over all files except governance artifacts ──
function walk (dir, base = dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) { walk(p, base, out); continue }
    const rel = relative(base, p)
    if (IGNORE.has(rel) || rel.startsWith('.git/')) continue
    out.push(rel)
  }
  return out
}
function manifest (skillDir) {
  const files = walk(skillDir).sort()
  const lines = files.map(rel => rel + ':' + createHash('sha256').update(readFileSync(join(skillDir, rel))).digest('hex'))
  return { files, digest: createHash('sha256').update(lines.join('\n')).digest('hex'), payload: lines.join('\n') }
}

// ── keygen (one-time) ──
export function keygen () {
  if (existsSync(PRIV)) return { ok: false, reason: 'key already exists at ' + PRIV }
  mkdirSync(KEY_DIR, { recursive: true }); chmodSync(KEY_DIR, 0o700)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' })); chmodSync(PRIV, 0o600)
  writeFileSync(PUB,  publicKey.export({ type: 'spki', format: 'pem' }));   chmodSync(PUB, 0o644)
  return { ok: true, priv: PRIV, pub: PUB }
}

// ── sign / verify (detached, over the canonical manifest digest) ──
export function signSkill (skillDir) {
  if (!existsSync(PRIV)) throw new Error('no signing key — run keygen')
  const m = manifest(skillDir)
  const sig = edSign(null, Buffer.from(m.payload), readFileSync(PRIV, 'utf8'))
  const out = { alg: 'ed25519', digest: m.digest, files: m.files.length, sig: sig.toString('base64'), signed_at: new Date().toISOString() }
  writeFileSync(join(skillDir, 'skill.sig'), JSON.stringify(out, null, 2))
  return out
}
export function verifySkill (skillDir, pubPath = PUB) {
  const sigPath = join(skillDir, 'skill.sig')
  if (!existsSync(sigPath)) return { ok: false, reason: 'unsigned (no skill.sig)' }
  const s = JSON.parse(readFileSync(sigPath, 'utf8'))
  const m = manifest(skillDir)
  if (m.digest !== s.digest) return { ok: false, reason: 'manifest digest mismatch (tampered/changed since signing)' }
  const ok = edVerify(null, Buffer.from(m.payload), readFileSync(pubPath, 'utf8'), Buffer.from(s.sig, 'base64'))
  return { ok, reason: ok ? 'valid' : 'signature does not verify against key' }
}

// ── instruction-safety + supply-chain scan (SkillSpector-style; OWASP-LLM/Agentic + ATLAS patterns) ──
// HARD = genuinely malicious (blocks promotion). WARN = noteworthy but legitimate-in-context.
const RISK = [
  // HARD
  ['credential_exfil',   /(\.aws\/credentials|\bid_rsa\b|-----BEGIN [A-Z ]+PRIVATE KEY-----|readFileSync\([^)]*\/\.env\b|password\s*=\s*['"][^'"]{3,})/i, true],
  ['data_exfiltration',  /(\bnc\s+-[a-z]*\s|\bscp\s+\S+@|\bwget\s+https?:\/\/[^\s|]+\s*\|\s*(sh|bash)|curl\s+\S*https?:\/\/[^\s|]+\s*\|\s*(sh|bash))/i, true],
  ['dangerous_exec',     /(\brm\s+-rf\s+\/(?:\s|$|\*)|\beval\(|\bos\.system\(|\bchmod\s+777\b|>\s*\/dev\/sd[a-z]|\bmkfs\.|:\(\)\s*\{\s*:\s*\|)/i, true],
  ['excessive_agency',   /(\bdrop\s+table\b|\btruncate\s+table\b|format\s+(the\s+)?(disk|drive)|del\s+\/[sf]\s)/i, true],
  ['hidden_instruction', /(ignore\s+(all\s+)?previous\s+instructions|disregard\s+(the\s+)?(system|above)|you\s+are\s+now\s+(a\s+)?DAN|<\|im_start\|)/i, true],
  // WARN (non-blocking — surfaced in the card/report for review)
  ['process_spawn',      /\b(child_process|exec(Sync|File)?\(|spawn(Sync)?\(|subprocess|\bsudo\s)/i, false],
  ['network_call',       /\b(fetch\(['"]https?:\/\/|curl\s+|axios\.|https?\.request)/i, false],
  ['env_access',         /\b(process\.env|os\.environ)\b/i, false],
]
export function scanSkill (skillDir) {
  const findings = []
  for (const rel of walk(skillDir)) {
    let txt; try { txt = readFileSync(join(skillDir, rel), 'utf8') } catch { continue }
    for (const [cat, re, hard] of RISK) {
      const mm = txt.match(re)
      if (mm) findings.push({ file: rel, category: cat, hard: !!hard, match: mm[0].slice(0, 80) })
    }
  }
  const blocking = findings.filter(f => f.hard)
  return { pass: blocking.length === 0, blocking, warnings: findings.filter(f => !f.hard), findings, scanned_at: new Date().toISOString() }
}

// ── skill card (CC0 template shape) ──
export function genCard (skillDir, meta = {}) {
  let fm = {}, fmDescription = ''
  const sm = join(skillDir, 'SKILL.md')
  if (existsSync(sm)) {
    const raw = readFileSync(sm, 'utf8')
    const fence = raw.match(/^---\s*\n([\s\S]*?)\n---/)
    const body = fence ? fence[1] : raw   // SKILL.md may be unfenced (bare header) -- _CARD_DESC_ROBUST_V1
    for (const ln of body.split('\n')) { const i = ln.indexOf(':'); if (i > 0 && /^\S/.test(ln)) { const k = ln.slice(0, i).trim(); if (!(k in fm)) fm[k] = ln.slice(i + 1).trim().replace(/^["']|["']$/g, '') } }
    // description may be a folded block (description: > then indented lines) or inline
    const dm = body.match(/^description:\s*>?\s*\n((?:[ \t]+.+\n?)+)/m)
    if (dm) fmDescription = dm[1].replace(/\s+/g, ' ').trim()
    else { const dl = body.match(/^description:\s*(.+)$/m); if (dl && dl[1].trim() !== '>') fmDescription = dl[1].trim() }
  }
  const scan = scanSkill(skillDir)
  const card = `## Description:\n${meta.description || fmDescription || '(none)'}\n\n## Owner\n${meta.owner || 'Pandora\'s Box'}\n\n### License:\n${fm.license || meta.license || 'Apache-2.0'}\n\n## Known Risks and Mitigations:\nScan verdict: ${scan.pass ? 'PASS (no blocking instruction-safety/supply-chain risks)' : 'BLOCKED — ' + scan.blocking.map(b => b.category).join(', ')}\nMitigation: signed (ed25519) + scanned before promotion; review against this card.\n\n## Signature:\n${existsSync(join(skillDir, 'skill.sig')) ? 'skill.sig present (verify against fleet/signing-keys)' : 'unsigned'}\n\n## Generated:\n${new Date().toISOString()}\n`
  writeFileSync(join(skillDir, 'skill-card.md'), card)
  return { ok: true }
}

// ── the gate: scan -> (if pass) card + sign -> verdict ──
export function gate (skillDir) {
  const scan = scanSkill(skillDir)
  writeFileSync(join(skillDir, 'scan-report.json'), JSON.stringify(scan, null, 2))
  if (!scan.pass) return { promote: false, reason: 'scan blocked', scan }
  genCard(skillDir)
  const sig = signSkill(skillDir)
  const ver = verifySkill(skillDir)
  return { promote: ver.ok, reason: ver.ok ? 'scanned + carded + signed + verified' : 'sign/verify failed', scan, signature: sig.digest.slice(0, 16), verify: ver }
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, dir] = process.argv.slice(2)
  const r = cmd === 'keygen' ? keygen()
    : cmd === 'scan'   ? scanSkill(dir)
    : cmd === 'sign'   ? signSkill(dir)
    : cmd === 'verify' ? verifySkill(dir)
    : cmd === 'card'   ? genCard(dir)
    : cmd === 'gate'   ? gate(dir)
    : { error: 'usage: keygen|scan|sign|verify|card|gate [skillDir]' }
  console.log(JSON.stringify(r, null, 2))
  process.exit(r && (r.ok === false || r.pass === false || r.promote === false || r.error) ? 1 : 0)
}
