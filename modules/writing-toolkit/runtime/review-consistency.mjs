// review-consistency.mjs
// Cross-book drift scan primitive.
// Scans assembled or per-chapter files for terminology, voice, and tech-lens drift.
//
// Signature: reviewConsistency(bookIds, projectRoot, dimensions, canonPaths, registryPath, opts)
// Returns: {ok, report: {[book_id]: {issues:[]}}, cross_book_issues:[], warnings}

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join }                                  from 'node:path'
import { makeMessage }                           from '${PBOX_SHARED}/anthropic-claude-adapter.mjs'

const VALID_DIMENSIONS = ['terminology-drift', 'voice-drift', 'tech-lens-drift', 'character-fact-contradictions']
const MAX_SAMPLE_CHARS = 8_000  // per-book sample size for cross-book comparison

function stripFrontmatter (content) {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 4)
  return end === -1 ? content : content.slice(end + 4).trimStart()
}

function sampleBook (bookDir) {
  if (!existsSync(bookDir)) return null

  // prefer assembled md
  const assembledDir = join(bookDir, 'assembled')
  if (existsSync(assembledDir)) {
    const mdFiles = readdirSync(assembledDir).filter(f => f.endsWith('.md'))
    if (mdFiles.length) {
      const text = readFileSync(join(assembledDir, mdFiles[0]), 'utf8')
      return text.slice(0, MAX_SAMPLE_CHARS)
    }
  }

  // fallback: sample first 3 chapters
  const chapters = readdirSync(bookDir)
    .filter(f => f.match(/^ch-\d+-.*\.md$/) && !f.includes('.r'))
    .sort()
    .slice(0, 3)

  if (!chapters.length) return null

  const parts = chapters.map(f => {
    const body = stripFrontmatter(readFileSync(join(bookDir, f), 'utf8'))
    return `[${f}]\n${body.slice(0, MAX_SAMPLE_CHARS / 3)}`
  })
  return parts.join('\n\n---\n\n')
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {string[]} bookIds       Book IDs to scan (book_id values from book-manifest.json)
 * @param {string}   projectRoot   Base path (drops/books/{slug}/ will be scanned)
 * @param {string[]} dimensions    Subset of valid dimensions
 * @param {string[]} canonPaths    Canon files for reference (used as consistency baseline)
 * @param {string}   registryPath  Registry for entity name consistency check
 * @param {object}   opts          { dry_run, bookSlugMap: {[book_id]: slug} }
 */
export async function reviewConsistency (bookIds, projectRoot, dimensions, canonPaths, registryPath, opts = {}) {
  const { dry_run = false, bookSlugMap = {} } = opts
  const warnings = []
  const t0       = Date.now()

  if (!bookIds?.length) return { ok: false, error: 'bookIds array is required (at least 2 books for cross-book review)' }

  const dims = (dimensions || VALID_DIMENSIONS).filter(d => VALID_DIMENSIONS.includes(d))
  if (!dims.length) {
    return { ok: false, error: `No valid dimensions. Valid: ${VALID_DIMENSIONS.join(', ')}` }
  }

  if (dry_run) {
    return { ok: true, dry_run: true, report: {}, cross_book_issues: [], warnings }
  }

  // ── gather samples ─────────────────────────────────────────────────────────
  const samples = {}
  for (const bookId of bookIds) {
    const slug    = bookSlugMap[bookId] || bookId
    const bookDir = join(projectRoot, 'drops', 'books', slug)
    const sample  = sampleBook(bookDir)
    if (!sample) {
      warnings.push(`No chapters found for ${bookId} at ${bookDir} — skipped`)
    } else {
      samples[bookId] = sample
    }
  }

  if (Object.keys(samples).length < 2) {
    return {
      ok: false,
      error: `Need at least 2 books with written chapters for cross-book consistency review. ` +
             `Found: ${Object.keys(samples).join(', ') || 'none'}.`,
      warnings,
    }
  }

  // ── canon context ──────────────────────────────────────────────────────────
  let canonContext = ''
  const MAX_CANON  = 80_000
  for (const p of (canonPaths || [])) {
    if (!existsSync(p)) continue
    const chunk = readFileSync(p, 'utf8')
    if (canonContext.length + chunk.length > MAX_CANON) break
    canonContext += '\n\n' + chunk
  }

  // ── build prompt ───────────────────────────────────────────────────────────
  const systemPrompt = [
    `You are a continuity editor for the examplebrand series — a multi-book sci-fi retelling of Greek mythology.`,
    `Your job is to identify DRIFT: places where different books use the same entity differently, `,
    `apply the tech-lens inconsistently, or contradict established character facts.`,
    ``,
    `Dimensions to check: ${dims.join(', ')}`,
    ``,
    `terminology-drift: same mythological entity referred to by different names or descriptions across books`,
    `voice-drift: narrative register, tense, or prose style shifting between books`,
    `tech-lens-drift: same tech element described differently (e.g. "thunderbolt" as weapon vs ordnance vs divine power)`,
    `character-fact-contradictions: a character's ability, role, or backstory contradicting itself across books`,
    canonContext ? `\n\n## CANON BASELINE\n${canonContext}` : '',
  ].filter(Boolean).join('\n')

  const sampleBlock = Object.entries(samples)
    .map(([id, text]) => `=== BOOK: ${id} ===\n${text}`)
    .join('\n\n')

  const userPrompt = [
    `Cross-book consistency review for: ${Object.keys(samples).join(', ')}`,
    ``,
    sampleBlock,
    ``,
    `Return a JSON object (no markdown fences) with this structure:`,
    `{`,
    `  "cross_book_issues": [`,
    `    { "dimension": "terminology-drift|voice-drift|tech-lens-drift|character-fact-contradictions",`,
    `      "books_affected": ["book-id-1","book-id-2"],`,
    `      "description": "specific issue description",`,
    `      "severity": "info|suggestion|issue|blocker"`,
    `    }`,
    `  ],`,
    `  "per_book": {`,
    Object.keys(samples).map(id => `    "${id}": []`).join(',\n'),
    `  }`,
    `}`,
  ].join('\n')

  let raw = ''
  try {
    raw = await makeMessage(systemPrompt, [{ role: 'user', content: userPrompt }])
  } catch (err) {
    return { ok: false, error: `Consistency review call failed: ${err.message}` }
  }

  let parsed = {}
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    warnings.push('Response was not valid JSON — returning raw')
    return { ok: true, unparsed: raw, cross_book_issues: [], report: {}, warnings }
  }

  return {
    ok:                true,
    books_reviewed:    Object.keys(samples),
    dimensions:        dims,
    cross_book_issues: parsed.cross_book_issues || [],
    report:            parsed.per_book || {},
    issue_count:       (parsed.cross_book_issues || []).length,
    time_s:            parseFloat(((Date.now() - t0) / 1000).toFixed(1)),
    warnings,
  }
}
