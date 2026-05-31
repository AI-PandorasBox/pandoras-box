// revise-chapter.mjs
// Generic chapter revision primitive.
// ALWAYS auto-versions — never overwrites existing files (C7).
//
// Signature: reviseChapter(chapterPath, revisionBrief, revisionScope, canonPaths, registryPath, styleSpec, opts)
// Returns: {ok, path, word_count_delta, diff_summary, warnings}

import {
  existsSync, readFileSync, writeFileSync, chmodSync,
} from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeMessage } from '${PBOX_SHARED}/anthropic-claude-adapter.mjs'

const VALID_SCOPES = ['tone', 'pacing', 'tech-lens', 'character', 'continuity', 'full']

// ── helpers ───────────────────────────────────────────────────────────────────

function countWords (text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function stripFrontmatter (content) {
  if (!content.startsWith('---')) return { meta: {}, body: content }
  const end = content.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: content }
  const metaBlock = content.slice(4, end)
  const body      = content.slice(end + 4).trimStart()
  const meta      = {}
  for (const line of metaBlock.split('\n')) {
    const m = line.match(/^(\w[\w_-]*):\s*(.*)$/)
    if (m) meta[m[1]] = m[2].trim().replace(/^"|"$/g, '')
  }
  return { meta, body }
}

function nextRevisionPath (chapterPath) {
  const ext     = extname(chapterPath)
  const noExt   = chapterPath.slice(0, -ext.length)
  // strip existing .rN suffix if present
  const cleaned = noExt.replace(/\.r\d+$/, '')
  let n = 2
  while (existsSync(`${cleaned}.r${n}${ext}`)) n++
  return `${cleaned}.r${n}${ext}`
}

function applyFilePerms (filePath, warnings) {
  try { chmodSync(filePath, 0o664) } catch (e) { warnings.push(`chmod 664 failed: ${e.message}`) }
  try {
    execFileSync('chgrp', ['claudeclaw', filePath], { timeout: 5_000 })
  } catch (e) {
    warnings.push(`chgrp claudeclaw failed: ${e.message}`)
  }
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {string}   chapterPath    Path to existing chapter .md file
 * @param {string}   revisionBrief  Plain-text description of what to change
 * @param {string}   revisionScope  One of: tone | pacing | tech-lens | character | continuity | full
 * @param {string[]} canonPaths     Canon files to include for context (optional; empty for minor revisions)
 * @param {string}   registryPath   Registry path (optional; pass null to skip entity context)
 * @param {object}   styleSpec      { preset, byline, extra_rules[] }
 * @param {object}   opts           { dry_run }
 */
export async function reviseChapter (chapterPath, revisionBrief, revisionScope, canonPaths, registryPath, styleSpec, opts = {}) {
  const { dry_run = false } = opts
  const warnings = []
  const t0       = Date.now()

  if (!chapterPath)   return { ok: false, error: 'chapterPath is required' }
  if (!revisionBrief) return { ok: false, error: 'revisionBrief is required' }

  const scope = revisionScope || 'full'
  if (!VALID_SCOPES.includes(scope)) {
    return { ok: false, error: `revisionScope must be one of: ${VALID_SCOPES.join(', ')}. Got: "${scope}"` }
  }

  if (!existsSync(chapterPath)) {
    return { ok: false, error: `Chapter file not found: ${chapterPath}` }
  }

  const outputPath = nextRevisionPath(chapterPath)

  if (dry_run) {
    return { ok: true, dry_run: true, path: outputPath, word_count_delta: 0, diff_summary: '(dry run)', warnings }
  }

  // ── read existing chapter ──────────────────────────────────────────────────
  const existing       = readFileSync(chapterPath, 'utf8')
  const { meta, body } = stripFrontmatter(existing)
  const originalWords  = countWords(body)

  // ── optional canon context (full scope revisions) ─────────────────────────
  let canonSnippet = ''
  if (scope === 'full' || scope === 'tech-lens') {
    const MAX_CHARS = 150_000
    for (const p of (canonPaths || [])) {
      if (!existsSync(p)) continue
      const chunk = readFileSync(p, 'utf8')
      if (canonSnippet.length + chunk.length > MAX_CHARS) break
      canonSnippet += '\n\n' + chunk
    }
  }

  // ── scope-to-instruction map ───────────────────────────────────────────────
  const SCOPE_INSTRUCTIONS = {
    'tone':        'Focus only on tone and register. Adjust voice warmth, gravity, or formality as directed. Do not change plot, structure, or tech-lens descriptions.',
    'pacing':      'Focus only on pacing. Adjust sentence rhythm, paragraph length, scene tempo. Do not change tone, plot, or tech details.',
    'tech-lens':   'Focus only on the technology-lens texture. Revise passages where tech is told rather than shown. Ensure the tech reads as divinity from mortal POV. Do not change plot or dialogue substantially.',
    'character':   'Focus only on character voice, action, and motivation in this chapter. Do not change plot structure or tech-lens descriptions.',
    'continuity':  'Focus only on continuity issues: facts, names, timeline, and prior-chapter consistency. Do not change style or structure.',
    'full':        'Apply the revision brief comprehensively across the entire chapter.',
  }

  const scopeInstruction = SCOPE_INSTRUCTIONS[scope]
  const preset = styleSpec?.preset || 'examplebrand_v1'

  const systemPrompt = [
    `You are revising a chapter of the examplebrand series (sci-fi retelling of Greek mythology).`,
    `British English throughout. Third-person limited, present tense. Mid-formal register.`,
    `Tech is shown not told. Never break the lens rules.`,
    ``,
    `REVISION SCOPE: ${scope.toUpperCase()}`,
    scopeInstruction,
    canonSnippet ? `\n\n## CANON CONTEXT\n${canonSnippet}` : '',
  ].filter(Boolean).join('\n')

  const userPrompt = [
    `REVISION BRIEF:`,
    revisionBrief,
    ``,
    `CURRENT CHAPTER:`,
    body,
    ``,
    `Return the complete revised chapter. No commentary, no explanation — just the chapter prose.`,
  ].join('\n')

  let revised = ''
  try {
    revised = await makeMessage(systemPrompt, [{ role: 'user', content: userPrompt }])
  } catch (err) {
    return { ok: false, error: `Revision call failed: ${err.message}` }
  }

  const newWords     = countWords(revised)
  const wordDelta    = newWords - originalWords
  const diffSummary  = `Word count: ${originalWords} → ${newWords} (${wordDelta >= 0 ? '+' : ''}${wordDelta}). Scope: ${scope}.`

  // ── write revised file with updated frontmatter ────────────────────────────
  const newMeta = {
    ...meta,
    word_count:   newWords,
    revised_at:   new Date().toISOString(),
    revision_scope: scope,
    parent_path:  chapterPath,
  }

  const fmLines = Object.entries(newMeta).map(([k, v]) =>
    `${k}: ${typeof v === 'string' && (v.includes(':') || v.includes('"')) ? `"${v.replace(/"/g, '\\"')}"` : v}`
  )
  const frontmatter = `---\n${fmLines.join('\n')}\n---\n\n`

  writeFileSync(outputPath, frontmatter + revised, 'utf8')
  applyFilePerms(outputPath, warnings)

  return {
    ok:              true,
    path:            outputPath,
    word_count_delta: wordDelta,
    diff_summary:    diffSummary,
    time_s:          parseFloat(((Date.now() - t0) / 1000).toFixed(1)),
    warnings,
  }
}
