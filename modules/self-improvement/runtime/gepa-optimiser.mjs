#!/usr/bin/env node
// gepa-optimiser.mjs -- Generated Edit Proposals, Aggregated
//
// Reads the personal-ai module's session log (one JSONL file per day) and
// produces an operator-facing markdown digest of prompt-improvement
// candidates. OPERATOR-GATED: writes to disk only, never modifies prompts,
// never calls the LLM, never touches personal-ai/.
//
// Inputs:  ${INSTALL_PATH}/personal-ai/store/sessions/YYYY-MM-DD.jsonl
//          (override with PBOX_SESSIONS_DIR for testing)
// Output:  ${INSTALL_PATH}/self-improvement/output/weekly-YYYY-MM-DD.md
//          (override with PBOX_GEPA_OUT_DIR for testing)

import fs from 'node:fs'
import path from 'node:path'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const SESSIONS_DIR = process.env.PBOX_SESSIONS_DIR
  || path.join(INSTALL_PATH, 'personal-ai', 'store', 'sessions')
const OUT_DIR = process.env.PBOX_GEPA_OUT_DIR
  || path.join(INSTALL_PATH, 'self-improvement', 'output')

const WINDOW_DAYS = 7
const REJECT_THRESHOLD = 3 // rating < 3 counts as rejected
const MAX_QUOTE_LEN = 600  // truncate quoted turns to keep digest readable

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function dayKey(d) {
  return d.toISOString().slice(0, 10)
}

// Build the set of YYYY-MM-DD strings covered by the window ending today.
function windowDays(endDate, days) {
  const out = []
  for (let i = 0; i < days; i++) {
    const d = new Date(endDate.getTime() - i * 24 * 60 * 60 * 1000)
    out.push(dayKey(d))
  }
  return out
}

// Parse one JSONL file. Tolerate blank lines + malformed lines (skip them).
function readSessionFile(file) {
  const turns = []
  let raw
  try { raw = fs.readFileSync(file, 'utf8') }
  catch { return turns }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      turns.push(obj)
    } catch {
      // skip malformed -- session log is best-effort, not a contract
    }
  }
  return turns
}

function loadWindow() {
  const days = windowDays(new Date(), WINDOW_DAYS)
  const allTurns = []
  let filesRead = 0
  if (!fs.existsSync(SESSIONS_DIR)) {
    return { allTurns, filesRead, missing: true }
  }
  for (const d of days) {
    const f = path.join(SESSIONS_DIR, `${d}.jsonl`)
    if (!fs.existsSync(f)) continue
    filesRead++
    for (const t of readSessionFile(f)) allTurns.push(t)
  }
  return { allTurns, filesRead, missing: false }
}

// Group ordered turns by conversation_id so we can look at neighbours.
function groupByConversation(turns) {
  const groups = new Map()
  for (const t of turns) {
    const id = t.conversation_id || '_unknown'
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(t)
  }
  // Preserve insertion order within each group; sort by ts if present.
  for (const arr of groups.values()) {
    arr.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')))
  }
  return groups
}

function classify(turn) {
  if (turn.role !== 'assistant') return null
  if (turn.rating != null && Number(turn.rating) < REJECT_THRESHOLD) return 'rejected'
  if (turn.regenerated === true) return 'regenerated'
  if (turn.corrected === true) return 'corrected'
  return null
}

function truncate(s, n = MAX_QUOTE_LEN) {
  if (typeof s !== 'string') return ''
  if (s.length <= n) return s
  return s.slice(0, n) + ' [...truncated]'
}

function quoteBlock(s) {
  // Render as a markdown blockquote, line-by-line.
  const t = truncate(s)
  return t.split('\n').map(l => `> ${l}`).join('\n')
}

// Lightweight word-diff: words in `corrective` that did not appear in `original`.
// Deterministic, no LLM. Just surfaces what the operator added.
function noveltyDiff(original, corrective) {
  const tokens = s => String(s || '').toLowerCase().match(/[a-z0-9']+/g) || []
  const origSet = new Set(tokens(original))
  const added = []
  const seen = new Set()
  for (const w of tokens(corrective)) {
    if (origSet.has(w)) continue
    if (seen.has(w)) continue
    seen.add(w)
    added.push(w)
  }
  return added.slice(0, 30)
}

function suggestionFor(kind, ctx) {
  if (kind === 'rejected') {
    return 'Consider clarifying when to ask vs answer. The assistant gave a direct answer where the user appears to have wanted more options.'
  }
  if (kind === 'regenerated') {
    return 'Consider tightening the response shape. Operator regenerated, suggesting the original response missed scope.'
  }
  if (kind === 'corrected') {
    const added = noveltyDiff(ctx.assistantContent, ctx.correctionContent)
    const hint = added.length
      ? ` Words added by the operator that were absent from the original response: ${added.join(', ')}.`
      : ''
    return `Operator correction suggests a missing constraint. Consider adding the correction's key constraint as an explicit instruction in the prompt.${hint}`
  }
  return ''
}

// Pull a couple of broad skill suggestions out of the corpus.
// Heuristic only: if a kind shows up >= 3 times across distinct conversations,
// it warrants a skill-library entry.
function proposeSkills(candidates) {
  const counts = { rejected: new Set(), regenerated: new Set(), corrected: new Set() }
  for (const c of candidates) {
    if (counts[c.kind]) counts[c.kind].add(c.conversationId)
  }
  const skills = []
  if (counts.rejected.size >= 3) {
    skills.push({
      name: 'clarifying-question-first',
      desc: 'When the user request is open-ended or has multiple plausible interpretations, ask one clarifying question before answering.'
    })
  }
  if (counts.regenerated.size >= 3) {
    skills.push({
      name: 'scoped-response-shape',
      desc: 'Match response length and format to the question. Short questions get short answers; structured asks get structured replies.'
    })
  }
  if (counts.corrected.size >= 3) {
    skills.push({
      name: 'constraint-extraction',
      desc: 'Re-read the user turn for hard constraints (deadlines, formats, exclusions) before drafting a response.'
    })
  }
  return skills
}

function findCandidates(groups) {
  const out = []
  for (const [convId, turns] of groups) {
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]
      const kind = classify(t)
      if (!kind) continue
      const prevUser = (() => {
        for (let j = i - 1; j >= 0; j--) {
          if (turns[j].role === 'user' || turns[j].role === 'operator') return turns[j]
        }
        return null
      })()
      const nextOperator = (() => {
        if (kind !== 'corrected') return null
        for (let j = i + 1; j < turns.length; j++) {
          if (turns[j].role === 'user' || turns[j].role === 'operator') return turns[j]
        }
        return null
      })()
      out.push({
        conversationId: convId,
        ts: t.ts || '',
        kind,
        rating: t.rating,
        assistantContent: t.content || '',
        userContent: prevUser ? (prevUser.content || '') : '',
        correctionContent: nextOperator ? (nextOperator.content || '') : '',
      })
    }
  }
  return out
}

function renderDigest({ candidates, allTurns, groups }) {
  const today = todayStr()
  const totals = {
    rejected: candidates.filter(c => c.kind === 'rejected').length,
    regenerated: candidates.filter(c => c.kind === 'regenerated').length,
    corrected: candidates.filter(c => c.kind === 'corrected').length,
  }
  const md = []
  md.push(`# Self-Improvement Digest -- ${today}`)
  md.push('')
  md.push('## Summary')
  md.push(`- Total conversations: ${groups.size}`)
  md.push(`- Total turns: ${allTurns.length}`)
  md.push(`- Candidates found: rejected=${totals.rejected}, regenerated=${totals.regenerated}, corrected=${totals.corrected}`)
  md.push('')
  md.push('## Proposed prompt edits')
  md.push('')

  if (candidates.length === 0) {
    md.push('_No prompt-improvement candidates detected in this window._')
    md.push('')
  } else {
    candidates.forEach((c, idx) => {
      md.push(`### Candidate ${idx + 1} -- conversation #${c.conversationId}, ${c.ts}`)
      md.push('**User asked:**')
      md.push(quoteBlock(c.userContent || '(no preceding user turn captured)'))
      md.push('')
      md.push('**Assistant said:**')
      md.push(quoteBlock(c.assistantContent || '(empty assistant turn)'))
      md.push('')
      const signal = c.kind === 'rejected'
        ? `rated ${c.rating}`
        : c.kind
      md.push(`**Signal:** ${signal}`)
      md.push('')
      if (c.kind === 'corrected') {
        md.push('**Operator correction:**')
        md.push(quoteBlock(c.correctionContent || '(no operator follow-up captured)'))
        md.push('')
      }
      md.push(`**Proposed edit:** ${suggestionFor(c.kind, c)}`)
      md.push('')
    })
  }

  const skills = proposeSkills(candidates)
  md.push('## Proposed skill additions')
  if (skills.length === 0) {
    md.push('- None this week.')
  } else {
    for (const s of skills) md.push(`- **${s.name}**: ${s.desc}`)
  }
  md.push('')

  md.push('## How to adopt')
  md.push('')
  md.push('Edits are NOT applied automatically. To adopt: copy the proposed edit text')
  md.push('into the relevant prompt source file under `<INSTALL_PATH>/personal-ai/prompts/`')
  md.push('(if you have customised prompts there) or follow your repo\'s prompt-management workflow.')
  md.push('')
  return md.join('\n')
}

function renderEmpty(reason) {
  const today = todayStr()
  return [
    `# Self-Improvement Digest -- ${today}`,
    '',
    '## Summary',
    '- No session data in the last 7 days',
    `- Reason: ${reason}`,
    '',
    '## Proposed prompt edits',
    '_None._',
    '',
    '## Proposed skill additions',
    '- None this week.',
    '',
    '## How to adopt',
    '',
    'Nothing to adopt this cycle.',
    ''
  ].join('\n')
}

export function runGepaOptimiser() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const today = todayStr()
  const outFile = path.join(OUT_DIR, `weekly-${today}.md`)

  const { allTurns, filesRead, missing } = loadWindow()
  let body
  if (missing) {
    body = renderEmpty(`sessions dir not found at ${SESSIONS_DIR}`)
  } else if (filesRead === 0 || allTurns.length === 0) {
    body = renderEmpty('no session files in window')
  } else {
    const groups = groupByConversation(allTurns)
    const candidates = findCandidates(groups)
    body = renderDigest({ candidates, allTurns, groups })
  }

  fs.writeFileSync(outFile, body)
  return { outFile, turns: allTurns.length, files: filesRead, missing }
}

// CLI entrypoint: `node gepa-optimiser.mjs`
const invokedDirectly = (() => {
  try {
    const argv1 = fs.realpathSync(process.argv[1] || '')
    const self = fs.realpathSync(new URL(import.meta.url).pathname)
    return argv1 === self
  } catch { return false }
})()

if (invokedDirectly) {
  const r = runGepaOptimiser()
  console.log(`[gepa-optimiser] wrote ${r.outFile} (turns=${r.turns}, files=${r.files}, missing=${r.missing})`)
}
