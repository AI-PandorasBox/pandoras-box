// review-chapter.mjs
// Generic chapter review primitive — advisory critic only (C6).
// Severity 'blocker' reserved for clear canon violations only.
// assistant always decides what to action.
//
// Signature: reviewChapter(chapterPath, dimensions, canonPaths, registryPath, styleSpec, opts)
// Returns: {ok, dimensions: {[dim]: {items:[{severity,note}], pass:bool}}, overall_pass, warnings}

import { existsSync, readFileSync } from 'node:fs'
import { makeMessage } from '${PBOX_SHARED}/anthropic-claude-adapter.mjs'

const VALID_DIMENSIONS  = ['tech-lens', 'canon', 'character-voice', 'pacing', 'continuity-with-prior']
const VALID_SEVERITIES  = ['info', 'suggestion', 'issue', 'blocker']

// 'blocker' ONLY for: canon-named character misnamed, technology breaking established tech-lens rules.
// All style/tone/pacing concerns are 'suggestion' at most. (C6)

function stripFrontmatter (content) {
  if (!content.startsWith('---')) return { meta: {}, body: content }
  const end = content.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: content }
  const meta = {}
  const metaBlock = content.slice(4, end)
  for (const line of metaBlock.split('\n')) {
    const m = line.match(/^(\w[\w_-]*):\s*(.*)$/)
    if (m) meta[m[1]] = m[2].trim().replace(/^"|"$/g, '')
  }
  return { meta, body: content.slice(end + 4).trimStart() }
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {string}   chapterPath   Path to chapter .md
 * @param {string[]} dimensions    Subset of: tech-lens, canon, character-voice, pacing, continuity-with-prior
 * @param {string[]} canonPaths    Canon files for context
 * @param {string}   registryPath  Registry path (null to skip)
 * @param {object}   styleSpec     { preset }
 * @param {object}   opts          { dry_run, prior_chapter_path }
 */
export async function reviewChapter (chapterPath, dimensions, canonPaths, registryPath, styleSpec, opts = {}) {
  const { dry_run = false, prior_chapter_path } = opts
  const warnings = []
  const t0       = Date.now()

  if (!chapterPath) return { ok: false, error: 'chapterPath is required' }
  if (!existsSync(chapterPath)) return { ok: false, error: `Chapter not found: ${chapterPath}` }

  const dims = (dimensions || VALID_DIMENSIONS).filter(d => VALID_DIMENSIONS.includes(d))
  if (!dims.length) {
    return { ok: false, error: `No valid dimensions. Valid: ${VALID_DIMENSIONS.join(', ')}` }
  }

  if (dry_run) {
    const result = {}
    for (const d of dims) result[d] = { items: [], pass: true }
    return { ok: true, dry_run: true, dimensions: result, overall_pass: true, warnings }
  }

  const { meta, body } = stripFrontmatter(readFileSync(chapterPath, 'utf8'))

  // ── optional context ───────────────────────────────────────────────────────
  let canonContext = ''
  const MAX_CHARS = 120_000
  for (const p of (canonPaths || [])) {
    if (!existsSync(p)) continue
    const chunk = readFileSync(p, 'utf8')
    if (canonContext.length + chunk.length > MAX_CHARS) break
    canonContext += '\n\n' + chunk
  }

  let priorTail = ''
  if (prior_chapter_path && existsSync(prior_chapter_path)) {
    const prev = stripFrontmatter(readFileSync(prior_chapter_path, 'utf8')).body
    priorTail  = prev.slice(-1500)  // last 1500 chars of prior chapter
  }

  // ── prompt ─────────────────────────────────────────────────────────────────
  const dimensionGuide = {
    'tech-lens':           'Does the chapter apply the examplebrand tech-overlay through texture (show, not tell)? Any passages where tech is stated explicitly rather than shown?',
    'canon':               'Are all named characters correctly identified per canon? Any tech readings that contradict the established lens rules?',
    'character-voice':     'Are character voices, motivations, and actions consistent with their canon profiles?',
    'pacing':              'Scene length, tension arc, paragraph rhythm. Is the pacing appropriate to the content?',
    'continuity-with-prior': 'Does this chapter follow naturally from the prior chapter? Any fact discontinuities, timeline issues, or style breaks?',
  }

  const systemPrompt = [
    `You are a critical reader for the examplebrand series — a sci-fi retelling of Greek mythology.`,
    `Your role is ADVISORY. You raise concerns; the author decides what to action.`,
    ``,
    `SEVERITY SCALE (strictly observed):`,
    `- blocker: reserved ONLY for (a) canon-named character clearly misnamed, or (b) technology usage that directly breaks the established tech-lens rules in the canon. NOTHING else qualifies.`,
    `- issue: clear problem that affects reader experience. Factual errors, plot inconsistencies, broken lens application.`,
    `- suggestion: worth considering but not essential. Style, tone, phrasing improvements.`,
    `- info: neutral observation.`,
    ``,
    `DO NOT use 'blocker' for style, tone, pacing, or anything that is a matter of authorial choice.`,
    canonContext ? `\n\n## CANON REFERENCE\n${canonContext}` : '',
    priorTail   ? `\n\n## END OF PRIOR CHAPTER (for continuity review)\n${priorTail}` : '',
  ].filter(Boolean).join('\n')

  const userPrompt = [
    `Review the following chapter on these dimensions: ${dims.join(', ')}.`,
    ``,
    `CHAPTER: "${meta.title || chapterPath}"`,
    `---`,
    body,
    `---`,
    ``,
    `For each dimension, return a JSON array of findings.`,
    `Return a single JSON object with this exact structure (no markdown fences):`,
    `{`,
    dims.map(d => `  "${d}": [{ "severity": "info|suggestion|issue|blocker", "note": "specific finding" }]`).join(',\n'),
    `}`,
    ``,
    `If a dimension has no findings, return an empty array []. Return only the JSON object.`,
  ].join('\n')

  let raw = ''
  try {
    raw = await makeMessage(systemPrompt, [{ role: 'user', content: userPrompt }])
  } catch (err) {
    return { ok: false, error: `Review call failed: ${err.message}` }
  }

  // ── parse response ─────────────────────────────────────────────────────────
  let parsed = {}
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    warnings.push('Response was not valid JSON — returning raw text in unparsed field')
    return { ok: true, unparsed: raw, dimensions: {}, overall_pass: true, warnings }
  }

  const dimensionsResult = {}
  let   hasBlocker       = false
  let   hasIssue         = false

  for (const dim of dims) {
    const items   = Array.isArray(parsed[dim]) ? parsed[dim] : []
    const cleaned = items.map(item => ({
      severity: VALID_SEVERITIES.includes(item.severity) ? item.severity : 'suggestion',
      note:     String(item.note || ''),
    }))
    const dimHasBlocker = cleaned.some(i => i.severity === 'blocker')
    const dimHasIssue   = cleaned.some(i => i.severity === 'issue')
    if (dimHasBlocker) hasBlocker = true
    if (dimHasIssue)   hasIssue   = true
    dimensionsResult[dim] = { items: cleaned, pass: !dimHasBlocker && !dimHasIssue }
  }

  return {
    ok:           true,
    chapter_path: chapterPath,
    dimensions:   dimensionsResult,
    overall_pass: !hasBlocker && !hasIssue,
    has_blockers: hasBlocker,
    has_issues:   hasIssue,
    time_s:       parseFloat(((Date.now() - t0) / 1000).toFixed(1)),
    warnings,
  }
}
