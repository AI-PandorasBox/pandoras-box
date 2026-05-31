// assemble-book.mjs
// Manuscript assembly primitive.
// Globs ch-*.md (sorts numerically by NN), stitches title page + ToC + copyright + colophon + chapters.
// DOCX and EPUB via pandoc if available; md always available as fallback.
//
// Signature: assembleBook(bookDir, title, outputFormat, includeFrontmatter, opts)
// Returns: {ok, path, total_word_count, chapter_count, warnings}

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync,
} from 'node:fs'
import { join }        from 'node:path'
import { spawnSync }   from 'node:child_process'

const VALID_FORMATS = ['md', 'docx', 'epub']
const PANDOC_PATHS  = ['/usr/local/bin/pandoc', '/usr/bin/pandoc', 'pandoc']

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

function chapterSortKey (filename) {
  const m = filename.match(/^ch-(\d+)-/)
  return m ? parseInt(m[1], 10) : 9999
}

function countWords (text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function findPandoc () {
  for (const p of PANDOC_PATHS) {
    const r = spawnSync(p, ['--version'], { encoding: 'utf8', timeout: 5_000 })
    if (r.status === 0) return p
  }
  return null
}

function buildTitlePage (title, bookId, byline) {
  return [
    `# ${title}`,
    ``,
    `*${byline}*`,
    ``,
    `---`,
    ``,
  ].join('\n')
}

function buildCopyright (title) {
  const year = new Date().getFullYear()
  return [
    ``,
    `---`,
    ``,
    `## Copyright`,
    ``,
    `Copyright © ${year} ExampleOwner.`,
    `All rights reserved. No part of this publication may be reproduced, distributed, or transmitted in any form or by any means without the prior written permission of the publisher.`,
    ``,
    `Published by examplebrand.`,
    ``,
    `*${title}* is a work of fiction. Names, characters, organisations, places, events, and incidents are either products of the author's imagination or are used fictitiously. Any resemblance to actual persons, living or dead, or actual events is purely coincidental.`,
    ``,
  ].join('\n')
}

function buildColophon () {
  return [
    ``,
    `---`,
    ``,
    `## Colophon`,
    ``,
    `This manuscript was assembled by the examplebrand writing toolchain.`,
    `Published by examplebrand.`,
    ``,
  ].join('\n')
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {string}  bookDir            Directory containing ch-NN-slug.md files
 * @param {string}  title              Book title (for title page and output filename)
 * @param {string}  outputFormat       'md' | 'docx' | 'epub'
 * @param {boolean} includeFrontmatter Include title page, ToC, copyright, colophon
 * @param {object}  opts               { byline, dry_run, book_id }
 */
export async function assembleBook (bookDir, title, outputFormat, includeFrontmatter, opts = {}) {
  const {
    byline   = 'ExampleOwner & assistant',
    dry_run  = false,
    book_id,
  } = opts

  const warnings = []
  const format   = outputFormat || 'md'

  if (!VALID_FORMATS.includes(format)) {
    return { ok: false, error: `outputFormat must be one of: ${VALID_FORMATS.join(', ')}. Got: "${format}"` }
  }

  if (!existsSync(bookDir)) {
    return { ok: false, error: `Book directory not found: ${bookDir}` }
  }

  // ── find and sort chapter files ────────────────────────────────────────────
  const allFiles   = readdirSync(bookDir)
  const chapters   = allFiles
    .filter(f => f.match(/^ch-\d+-[^/]+\.md$/) && !f.includes('.partial') && !f.includes('.r'))
    .sort((a, b) => chapterSortKey(a) - chapterSortKey(b))

  if (!chapters.length) {
    return { ok: false, error: `No chapter files found in ${bookDir}. Expected ch-NN-slug.md format.` }
  }

  const assembledDir = join(bookDir, 'assembled')
  const safeTitle    = title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-').slice(0, 60)
  const outputPath   = join(assembledDir, `${safeTitle}.${format}`)

  if (dry_run) {
    return {
      ok: true, dry_run: true, path: outputPath,
      total_word_count: 0, chapter_count: chapters.length, warnings,
    }
  }

  mkdirSync(assembledDir, { recursive: true })

  // ── stitch markdown ────────────────────────────────────────────────────────
  const chapterParts = []
  let   totalWords   = 0

  for (const f of chapters) {
    const content = readFileSync(join(bookDir, f), 'utf8')
    const { meta, body } = stripFrontmatter(content)
    const chTitle  = meta.title || f.replace(/^ch-\d+-/, '').replace(/-/g, ' ').replace(/\.md$/, '')
    const words    = countWords(body)
    totalWords    += words
    chapterParts.push(`\n\n---\n\n## ${chTitle}\n\n${body}`)
  }

  // ToC
  const tocLines = chapters.map((f, i) => {
    const content  = readFileSync(join(bookDir, f), 'utf8')
    const { meta } = stripFrontmatter(content)
    const chTitle  = meta.title || f.replace(/^ch-\d+-/, '').replace(/-/g, ' ').replace(/\.md$/, '')
    return `${i + 1}. ${chTitle}`
  })
  const toc = includeFrontmatter
    ? `\n\n## Contents\n\n${tocLines.join('\n')}\n`
    : ''

  const parts = []
  if (includeFrontmatter) {
    parts.push(buildTitlePage(title, book_id || '', byline))
    parts.push(toc)
    parts.push(buildCopyright(title))
  }
  parts.push(...chapterParts)
  if (includeFrontmatter) {
    parts.push(buildColophon())
  }

  const fullMd = parts.join('\n')

  // ── output ─────────────────────────────────────────────────────────────────
  if (format === 'md') {
    writeFileSync(outputPath, fullMd, 'utf8')
    return {
      ok: true, path: outputPath,
      total_word_count: totalWords, chapter_count: chapters.length, warnings,
    }
  }

  // DOCX or EPUB: need pandoc
  const pandoc = findPandoc()
  if (!pandoc) {
    warnings.push(`pandoc not found — falling back to markdown output`)
    const mdFallback = outputPath.replace(/\.(docx|epub)$/, '.md')
    writeFileSync(mdFallback, fullMd, 'utf8')
    return {
      ok: true, path: mdFallback,
      total_word_count: totalWords, chapter_count: chapters.length,
      warnings: [...warnings, `Requested ${format} but pandoc unavailable — saved as .md`],
    }
  }

  const tempMd = join(assembledDir, `.tmp-assemble-${Date.now()}.md`)
  writeFileSync(tempMd, fullMd, 'utf8')

  const pandocArgs = [tempMd, '-o', outputPath]
  if (format === 'epub') {
    pandocArgs.push('--toc', '--toc-depth=1')
    if (includeFrontmatter) pandocArgs.push('--metadata', `title=${title}`, '--metadata', `author=${byline}`)
  }
  if (format === 'docx') {
    pandocArgs.push('--from=markdown', '--to=docx')
  }

  const result = spawnSync(pandoc, pandocArgs, { encoding: 'utf8', timeout: 120_000 })
  try { unlinkSync(tempMd) } catch {}

  if (result.status !== 0) {
    return {
      ok: false,
      error: `pandoc conversion to ${format} failed: ${result.stderr || result.stdout}`,
      warnings,
    }
  }

  return {
    ok: true, path: outputPath,
    total_word_count: totalWords, chapter_count: chapters.length, warnings,
  }
}
