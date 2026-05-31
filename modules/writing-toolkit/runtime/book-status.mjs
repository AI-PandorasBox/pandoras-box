// book-status.mjs
// Per-book progress primitive. Reads state.json + scans chapter files.
//
// Signature: bookStatus(bookId, bookDir, opts)
// Returns: {chapters_planned, chapters_written, chapters_reviewed, total_words, status_per_chapter:[...]}

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function stripFrontmatter (content) {
  if (!content.startsWith('---')) return { meta: {}, body: content }
  const end = content.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: content }
  const meta = {}
  content.slice(4, end).split('\n').forEach(line => {
    const m = line.match(/^(\w[\w_-]*):\s*(.*)$/)
    if (m) meta[m[1]] = m[2].trim().replace(/^"|"$/g, '')
  })
  return { meta, body: content.slice(end + 4).trimStart() }
}

function countWords (text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function chapterSortKey (filename) {
  const m = filename.match(/^ch-(\d+)-/)
  return m ? parseInt(m[1], 10) : 9999
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {string}  bookId   Book identifier (used in return value only)
 * @param {string}  bookDir  Path to the book directory (contains ch-*.md + state.json)
 * @param {object}  opts     { dry_run }
 */
export function bookStatus (bookId, bookDir, opts = {}) {
  const { dry_run = false } = opts

  if (!bookId)  return { ok: false, error: 'bookId is required' }
  if (!bookDir) return { ok: false, error: 'bookDir is required' }

  if (dry_run) {
    return { ok: true, dry_run: true, book_id: bookId, chapters_planned: 0, chapters_written: 0, chapters_reviewed: 0, total_words: 0, status_per_chapter: [] }
  }

  if (!existsSync(bookDir)) {
    return { ok: false, error: `Book directory not found: ${bookDir}` }
  }

  // ── read state.json ────────────────────────────────────────────────────────
  const statePath  = join(bookDir, 'state.json')
  let   state      = {}
  if (existsSync(statePath)) {
    try { state = JSON.parse(readFileSync(statePath, 'utf8')) } catch {}
  }

  // ── scan chapter files ─────────────────────────────────────────────────────
  const allFiles = readdirSync(bookDir)

  // written chapters (canonical .md, not revisions or partials)
  const writtenFiles = allFiles
    .filter(f => f.match(/^ch-\d+-[^/]+\.md$/) && !f.includes('.r') && !f.includes('.partial'))
    .sort((a, b) => chapterSortKey(a) - chapterSortKey(b))

  // review files
  const reviewsDir    = join(bookDir, 'reviews')
  const reviewedIds   = new Set()
  if (existsSync(reviewsDir)) {
    readdirSync(reviewsDir)
      .filter(f => f.endsWith('.review.json'))
      .forEach(f => {
        const id = f.replace('.review.json', '')
        reviewedIds.add(id)
      })
  }

  // per-chapter status
  const statusPerChapter = writtenFiles.map(filename => {
    const filepath      = join(bookDir, filename)
    const content       = readFileSync(filepath, 'utf8')
    const { meta, body } = stripFrontmatter(content)
    const chId          = meta.chapter_id || filename.replace(/\.md$/, '')
    const words         = parseInt(meta.word_count, 10) || countWords(body)
    const reviewed      = reviewedIds.has(chId)

    // count blockers from review json if present
    let blockers = 0
    const reviewPath = join(reviewsDir, `${chId}.review.json`)
    if (reviewed && existsSync(reviewPath)) {
      try {
        const review = JSON.parse(readFileSync(reviewPath, 'utf8'))
        const dims   = review.dimensions || {}
        for (const items of Object.values(dims)) {
          if (Array.isArray(items)) {
            blockers += items.filter(i => i.severity === 'blocker').length
          } else if (items?.items) {
            blockers += (items.items || []).filter(i => i.severity === 'blocker').length
          }
        }
      } catch {}
    }

    return {
      ch_id:      chId,
      filename,
      title:      meta.title || filename,
      written:    true,
      reviewed,
      word_count: words,
      blockers,
    }
  })

  const totalWords        = statusPerChapter.reduce((s, c) => s + c.word_count, 0)
  const chaptersWritten   = statusPerChapter.length
  const chaptersReviewed  = statusPerChapter.filter(c => c.reviewed).length
  const chaptersPlanned   = state.chapters_planned || chaptersWritten

  const overallStatus =
    chaptersWritten === 0                                  ? 'awaiting_chapters' :
    chaptersWritten < chaptersPlanned                      ? 'in_progress' :
    chaptersReviewed < chaptersWritten                     ? 'awaiting_review' :
    statusPerChapter.some(c => c.blockers > 0)             ? 'review_blockers' :
                                                             'complete'

  return {
    ok:                  true,
    book_id:             bookId,
    book_dir:            bookDir,
    chapters_planned:    chaptersPlanned,
    chapters_written:    chaptersWritten,
    chapters_reviewed:   chaptersReviewed,
    total_words:         totalWords,
    status:              overallStatus,
    state_json:          state,
    status_per_chapter:  statusPerChapter,
  }
}
