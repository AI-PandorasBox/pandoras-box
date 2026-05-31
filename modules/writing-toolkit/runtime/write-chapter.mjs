// write-chapter.mjs
// Generic chapter writer primitive. Tooled pattern: one bounded Claude call per chapter.
// No history, no chat — single-flight via anthropic-claude-adapter (C9).
//
// Signature: writeChapter(projectRoot, canonPaths, registryPath, outlineBlock, styleSpec, opts)
// Returns: {ok, path, word_count, time_s, beats_covered, registry_terms_used, warnings}
//
// Constraints enforced here:
//   C2 — word_target hard-capped at 4000
//   C3 — partial recovery: writes .partial.md before call, saves on interrupt, returns partial result
//   C4 — registry gate: canonical.json must exist with >=100 entities
//   C5 — file mode 664 + chgrp claudeclaw on output
//   C7 — auto-versioning: refuses overwrite unless force=true; force writes to .r{N}.md

import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
  chmodSync, unlinkSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeMessage } from '${PBOX_SHARED}/anthropic-claude-adapter.mjs'

const WORD_TARGET_CAP  = 4000
const MAX_CANON_CHARS  = 400_000  // ~100K tokens budget (C1)

// ── helpers ───────────────────────────────────────────────────────────────────

function countWords (text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function slugify (s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

function ensureDir (d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function nextVersionPath (baseNoExt) {
  let n = 2
  while (existsSync(`${baseNoExt}.r${n}.md`)) n++
  return `${baseNoExt}.r${n}.md`
}

// C4: registry gate — accepts JSONL (one JSON per line) or JSON array
function checkRegistry (registryPath) {
  if (!existsSync(registryPath)) {
    return {
      ok: false,
      error: `Registry not found at ${registryPath}. ` +
             `Run examplebrand_extract_entities (all sources), examplebrand_canonicalise_entities, ` +
             `then examplebrand_assign_overlay first.`,
    }
  }
  const raw   = readFileSync(registryPath, 'utf8').trim()
  let count   = 0
  if (raw.startsWith('[')) {
    try { count = JSON.parse(raw).length } catch { count = 0 }
  } else {
    count = raw.split('\n').filter(l => l.trim()).length
  }
  if (count < 100) {
    return {
      ok: false,
      error: `Registry at ${registryPath} has only ${count} entities (minimum 100 required). ` +
             `Registry build is incomplete — run remaining extract/canonicalise/overlay steps.`,
    }
  }
  return { ok: true, count }
}

function lookupEntity (name, registryLines) {
  const nl = name.toLowerCase().trim()
  for (const line of registryLines) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e.canonical_name?.toLowerCase() === nl) return e
      if ((e.aliases || []).some(a => a.toLowerCase() === nl)) return e
    } catch {}
  }
  // fuzzy fallback: starts-with
  for (const line of registryLines) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e.canonical_name?.toLowerCase().startsWith(nl.slice(0, 4))) return e
    } catch {}
  }
  return null
}

function applyFilePerms (filePath, warnings) {
  try { chmodSync(filePath, 0o664) } catch (e) { warnings.push(`chmod 664 failed: ${e.message}`) }
  try {
    execFileSync('chgrp', ['claudeclaw', filePath], { timeout: 5_000 })
  } catch (e) {
    warnings.push(`chgrp claudeclaw failed (deploy-time chown will set group): ${e.message}`)
  }
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {string}   projectRoot   Base path; output goes to projectRoot/drops/books/{book_slug}/
 * @param {string[]} canonPaths    Ordered list of canon file paths to load (C1: capped at ~100K tokens)
 * @param {string}   registryPath  Path to entities JSONL or JSON (C4 gate applied)
 * @param {object}   outlineBlock  { book_id, book_slug, chapter_id, chapter_number, title, slug?,
 *                                   summary, beats[], required_entities[], source_ref? }
 * @param {object}   styleSpec     { preset, byline, extra_rules[] } — examplebrand defaults injected by activation layer
 * @param {object}   opts          { word_target, force, dry_run, prior_chapter_tail }
 */
export async function writeChapter (projectRoot, canonPaths, registryPath, outlineBlock, styleSpec, opts = {}) {
  const {
    word_target       = 4000,
    force             = false,
    dry_run           = false,
    prior_chapter_tail,
  } = opts

  const warnings = []
  const t0       = Date.now()

  // ── input validation ───────────────────────────────────────────────────────
  if (!outlineBlock?.book_id)     return { ok: false, error: 'outlineBlock.book_id is required' }
  if (!outlineBlock?.chapter_id)  return { ok: false, error: 'outlineBlock.chapter_id is required' }
  if (!outlineBlock?.title)       return { ok: false, error: 'outlineBlock.title is required' }

  // C2: word_target cap
  if (word_target > WORD_TARGET_CAP) {
    return {
      ok: false,
      error: `word_target ${word_target} exceeds cap of ${WORD_TARGET_CAP}. ` +
             `V1 limit is 4000 words (~80-100s, safely under bridge timeout). Use word_target <= 4000.`,
    }
  }

  // C4: registry gate
  const regCheck = checkRegistry(registryPath)
  if (!regCheck.ok) return { ok: false, error: regCheck.error }

  // ── determine output path (C7: auto-versioning) ────────────────────────────
  const bookSlug   = outlineBlock.book_slug || slugify(outlineBlock.book_id)
  const chSlug     = outlineBlock.slug || slugify(outlineBlock.title)
  const chNN       = String(outlineBlock.chapter_number || 1).padStart(2, '0')
  const bookDir    = ensureDir(join(projectRoot, 'drops', 'books', bookSlug))
  const basePath   = join(bookDir, `ch-${chNN}-${chSlug}.md`)
  let   outputPath = basePath

  if (existsSync(basePath)) {
    if (!force) {
      return {
        ok: false,
        error: `Chapter already exists: ${basePath}. Pass force=true to auto-version to .r2.md (C7).`,
      }
    }
    outputPath = nextVersionPath(basePath.slice(0, -3))
  }

  if (dry_run) {
    return { ok: true, dry_run: true, path: outputPath, word_count: 0, time_s: 0, beats_covered: [], registry_terms_used: [], warnings }
  }

  // ── load canon (C1: budget-capped) ────────────────────────────────────────
  let canonText = ''
  for (const p of (canonPaths || [])) {
    if (!existsSync(p)) { warnings.push(`Canon path not found: ${p}`); continue }
    const chunk = readFileSync(p, 'utf8')
    if (canonText.length + chunk.length > MAX_CANON_CHARS) {
      const remaining = MAX_CANON_CHARS - canonText.length
      if (remaining > 200) canonText += '\n\n' + chunk.slice(0, remaining)
      warnings.push(`Canon budget reached — ${p} truncated or skipped`)
      break
    }
    canonText += '\n\n' + chunk
  }

  // ── registry entity lookup ─────────────────────────────────────────────────
  const registryRaw     = readFileSync(registryPath, 'utf8')
  const registryLines   = registryRaw.startsWith('[')
    ? JSON.parse(registryRaw).map(e => JSON.stringify(e))
    : registryRaw.split('\n')

  const requiredEntities  = outlineBlock.required_entities || []
  const entityRecords     = []
  for (const name of requiredEntities) {
    const rec = lookupEntity(name, registryLines)
    if (rec) entityRecords.push(rec)
    else     warnings.push(`Entity not found in registry: "${name}"`)
  }
  const registryTermsUsed = entityRecords.map(e => e.canonical_name)

  // ── build prompts ──────────────────────────────────────────────────────────
  const preset  = styleSpec?.preset || 'examplebrand_v1'
  const byline  = styleSpec?.byline || 'ExampleOwner & assistant'
  const extras  = (styleSpec?.extra_rules || []).join('\n')

  const systemPrompt = [
    `You are writing a chapter for the examplebrand series — a science-fiction retelling of Greek mythology.`,
    `The civilisation of examplebrand is an advanced technological society. The gods are engineers, administrators, and technologists.`,
    ``,
    `LENS RULES (never break these):`,
    `- Tech is SHOWN not told. Characters feel, see, hear the tech; the narrator does not explain it.`,
    `- Mortal POV: tech reads as divinity. The hammer is Hephaestus's hammer; the lightning is Zeus's wrath.`,
    `- British English throughout. Third-person limited, present tense. Mid-formal register.`,
    `- No anachronism in dialogue. No modern slang, no "thou/thee" archaisms.`,
    `- Rule 1: plot follows the canonical source. No invented outcomes. No invented named characters.`,
    `- Rule 2: interpretation permitted; invention of new plot elements is not.`,
    `- Target prose: ${word_target} words of chapter body (no chapter heading line needed).`,
    extras ? `\nADDITIONAL STYLE RULES:\n${extras}` : '',
    canonText ? `\n\n## CANON CONTEXT (tech-lens rules, character cards, source map)\n${canonText}` : '',
    entityRecords.length > 0
      ? `\n\n## REGISTRY RECORDS (apply these tech readings when these entities appear in the chapter)\n` +
        entityRecords.map(e =>
          `- ${e.canonical_name}${e.aliases?.length ? ` (also: ${e.aliases.slice(0,3).join(', ')})` : ''}: ` +
          `${e.tech_reading || e.examplebrand_classification || 'see canon'}` +
          (e.source_attestations?.[0] ? ` — source: ${e.source_attestations[0].line_ref}` : '')
        ).join('\n')
      : '',
  ].filter(Boolean).join('\n')

  const userPrompt = [
    `Write chapter "${outlineBlock.title}" (chapter ${outlineBlock.chapter_number || '?'} of ${outlineBlock.book_id}).`,
    ``,
    `OUTLINE:`,
    `Summary: ${outlineBlock.summary || '(none provided)'}`,
    outlineBlock.beats?.length ? `Beats to cover:\n${outlineBlock.beats.map((b, i) => `  ${i + 1}. ${b}`).join('\n')}` : '',
    outlineBlock.source_ref ? `Source passage: ${outlineBlock.source_ref}` : '',
    prior_chapter_tail
      ? `\nFINAL LINES OF PREVIOUS CHAPTER (match style, maintain continuity):\n${prior_chapter_tail}`
      : '',
    ``,
    `Write the complete chapter prose now. Start directly with the narrative — no "Chapter N:" heading. ` +
    `Aim for exactly ${word_target} words. Do not truncate early.`,
  ].filter(Boolean).join('\n')

  // ── C3: write partial marker before call ──────────────────────────────────
  const partialPath = outputPath.replace(/\.md$/, '.partial.md')
  writeFileSync(
    partialPath,
    `---\npartial: true\nchapter_id: ${outlineBlock.chapter_id}\nbook_id: ${outlineBlock.book_id}\ntitle: "${outlineBlock.title}"\nstarted_at: ${new Date().toISOString()}\n---\n\n<!-- chapter call in progress -->\n`,
    'utf8'
  )

  // ── call Claude via bridge adapter (C9) ───────────────────────────────────
  let content = ''
  try {
    content = await makeMessage(systemPrompt, [{ role: 'user', content: userPrompt }])
  } catch (err) {
    writeFileSync(
      partialPath,
      readFileSync(partialPath, 'utf8').replace('in progress', `interrupted — ${err.message}`),
      'utf8'
    )
    return {
      ok: false, partial: true, path: partialPath, words_so_far: 0,
      error: `Chapter call interrupted: ${err.message}. Partial marker saved to ${partialPath}. ` +
             `Retry with a lower word_target or resume with continuation prompt.`,
    }
  }

  // ── clean up partial on success ────────────────────────────────────────────
  try { unlinkSync(partialPath) } catch {}

  // ── build output file ──────────────────────────────────────────────────────
  const wordCount  = countWords(content)
  const beatsCovered = outlineBlock.beats || []

  const frontmatter = [
    '---',
    `chapter_id: ${outlineBlock.chapter_id}`,
    `book_id: ${outlineBlock.book_id}`,
    `title: "${(outlineBlock.title || '').replace(/"/g, '\\"')}"`,
    `word_count: ${wordCount}`,
    `generated_at: ${new Date().toISOString()}`,
    `byline: "${byline}"`,
    `style_preset: ${preset}`,
    `model_id: ${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'}`,
    `beats_covered: ${JSON.stringify(beatsCovered)}`,
    '---',
    '',
  ].join('\n')

  writeFileSync(outputPath, frontmatter + content, 'utf8')

  // C5: mode 664 + chgrp claudeclaw
  applyFilePerms(outputPath, warnings)

  return {
    ok:                 true,
    path:               outputPath,
    word_count:         wordCount,
    time_s:             parseFloat(((Date.now() - t0) / 1000).toFixed(1)),
    beats_covered:      beatsCovered,
    registry_terms_used: registryTermsUsed,
    warnings,
  }
}
