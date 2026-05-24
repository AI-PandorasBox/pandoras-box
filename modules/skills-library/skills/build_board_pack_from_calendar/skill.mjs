// build_board_pack_from_calendar skill -- _SKILL_TENANT_AGNOSTIC_V1
// Stages: 1=calendar pull (retry+checkpoint), 2=xlsx assembly (row-count verify), 3=PDF (Chrome headless)
// Resumable: pass run_id from a previous call to skip already-completed weeks.
//
// Tenant-agnostic: caller supplies mailbox_tenant_key (any valid mnemosyne MCP
// tenant) and output_label (used only for file naming + the PDF cover line).
// The skill does not interpret either string. Activation-layer concern.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

// Resolve exceljs from mnemosyne's node_modules (skill runs inside mnemosyne process)
const _require = createRequire((process.env.PBOX_NODE_BASE || '/opt/pandoras-box/personal-ai/runtime') + '/package.json')
const ExcelJS = _require('exceljs')

const SKILL_DIR = dirname(fileURLToPath(import.meta.url))
const RUNS_DIR  = join(SKILL_DIR, 'runs')
const CHROME    = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// Parse period string into { year, startWeek, endWeek }
// Accepts: Q1-2026, Q2-2026, Q3-2026, Q4-2026, W1-W18-2026
function parsePeriod (period) {
  const qm = period.match(/^Q([1-4])-(\d{4})$/)
  if (qm) {
    const q    = parseInt(qm[1])
    const year = parseInt(qm[2])
    const map  = { 1: [1, 13], 2: [14, 26], 3: [27, 39], 4: [40, 52] }
    const [sw, ew] = map[q]
    return { year, startWeek: sw, endWeek: ew }
  }
  const wm = period.match(/^W(\d+)-W(\d+)-(\d{4})$/)
  if (wm) {
    return { year: parseInt(wm[3]), startWeek: parseInt(wm[1]), endWeek: parseInt(wm[2]) }
  }
  throw new Error('Invalid period "' + period + '". Use Q1-2026 or W1-W18-2026.')
}

// Return ISO week Monday 00:00 UTC and following Monday 00:00 UTC as ISO strings
function isoWeekRange (year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow  = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - (dow - 1) + (week - 1) * 7)
  const nextMonday = new Date(monday)
  nextMonday.setUTCDate(monday.getUTCDate() + 7)
  return { start: monday.toISOString(), end: nextMonday.toISOString() }
}

function fmtTime (isoStr) {
  if (!isoStr) return ''
  try {
    const d = new Date(isoStr)
    return d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })
  } catch { return isoStr.slice(11, 16) }
}

function fmtDate (isoStr) {
  if (!isoStr) return ''
  try {
    const d = new Date(isoStr)
    return d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return isoStr.slice(0, 10) }
}

// Sanitise a label for filesystem use
function safeLabel (s) {
  return String(s || 'unlabelled').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) || 'unlabelled'
}

// _SKILL_ATTENDEES_FROM_DESC_V1: extract attendee count from bodyPreview / subject.
// Levels event template uses "Attending N..." line; fallbacks for free-text.
function extractAttendees (subject, description) {
  // _ATTENDEES_REGEX_V2: widened further -- "Number of pupils:", "N students attended", "N person(s)", "N people"
  const text = (description || '').replace(/\s+/g, ' ')
  const subj = (subject || '')
  if (/Attending\s+Multiple guests/i.test(text)) return ''
  if (/Attending\s+[—–-]\s/i.test(text)) return ''
  // Range upper: "Attending 11-20 guests"
  const mRange = text.match(/Attending\s+\d+-(\d+)/i)
  if (mRange) return parseInt(mRange[1])
  // Sum AM+PM pattern from descriptions: "30am+30pm" / "30 AM + 30 PM"
  const mSum = text.match(/(\d+)\s*(?:am|AM)\s*\+\s*(\d+)\s*(?:pm|PM)/)
  if (mSum) return parseInt(mSum[1]) + parseInt(mSum[2])
  // KS multiplier "KS2 25x3" -> 25 (single-session size, not total)
  const mKS = text.match(/KS[1-5]\s+(\d+)\s*[x×]/i)
  if (mKS) return parseInt(mKS[1])
  // Explicit count after Attending
  const m1 = text.match(/Attending\s+(?:~\s*)?(\d+)/i)
  if (m1) return parseInt(m1[1])
  // _ATTENDEES_REGEX_V2: structured count fields: "Number of pupils: N", "Number of attendees: N"
  const mNumPup = text.match(/Number\s+of\s+(?:pupils?|attendees?|students?|guests?|children|visitors?)\s*[:\-]\s*(\d+)/i)
  if (mNumPup) return parseInt(mNumPup[1])
  // _ATTENDEES_REGEX_V2: past-tense attendance: "5 students attended", "3 attended, 2 called in"
  const mAttended = text.match(/(\d+)\s+(?:students?|guests?|pupils?|kids?|attendees?)?\s*attended\b/i)
  if (mAttended) return parseInt(mAttended[1])
  // Subject pattern: "(7 guests)", "8 pupils"
  const m2 = subj.match(/(\d+)\s+(?:guests?|visitors?|pupils?|children|kids?|clients?|adults?|attendees?|pax|YP|young\s+people|persons?|people)\b/i)
  if (m2) return parseInt(m2[1])
  // Description fallback (now also matches "person/people")
  const m3 = text.match(/(\d+)\s+(?:guests?|visitors?|pupils?|children|kids?|clients?|adults?|attendees?|pax|YP|young\s+people|persons?|people)\b/i)
  if (m3) return parseInt(m3[1])
  return ''
}

// _SKILL_POST_PROCESS_V1: rule helpers for Stage 4 post-processing
function _normaliseSubject (s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase() }
function _matchAny (str, regexes) { return (regexes || []).some(rx => new RegExp(rx, 'i').test(str || '')) } // _MATCHANY_I_V1
function _matchExclude (subject, ex) {
  if (!ex) return false
  if (Array.isArray(ex.subject_match) && _matchAny(subject, ex.subject_match)) return true
  return false
}
function _categoryFor (row, rules) {
  const cats = rules.categories || {}
  const order = rules.tab_order || Object.keys(cats)
  for (const cat of order) {
    const def = cats[cat]
    if (!def) continue
    if (def.fallback) continue   // try as last resort
    if (def.exclude && _matchExclude(row.subject, def.exclude)) continue
    if (def.subject_match && _matchAny(row.subject, def.subject_match)) {
      if (def.require && def.require.attendees_min != null) {
        const att = typeof row.attendees === 'number' ? row.attendees : -1
        if (att < def.require.attendees_min) continue
      }
      return cat
    }
  }
  for (const cat of order) {
    const def = cats[cat]
    if (def && def.fallback) return cat
  }
  return 'Misc'
}
function _dedupRows (rows, keys) {
  if (!keys || keys.length === 0) return rows
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const key = keys.map(k => k === 'normalised_subject' ? _normaliseSubject(r.subject) : (r[k] || '')).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}
function _flattenWeeks (weekResults) {
  const out = []
  for (const wd of weekResults) {
    for (const ev of wd.events || []) {
      const startDt = ev.start && ev.start.dateTime ? ev.start.dateTime : null
      const endDt   = ev.end   && ev.end.dateTime   ? ev.end.dateTime   : null
      let durHrs = ''
      if (startDt && endDt) {
        const ms = new Date(endDt).getTime() - new Date(startDt).getTime()
        if (Number.isFinite(ms) && ms >= 0) durHrs = Math.round((ms / 3_600_000) * 100) / 100
      }
      const orgName = (ev.organizer && ev.organizer.emailAddress &&
                      (ev.organizer.emailAddress.name || ev.organizer.emailAddress.address)) || ''
      const description = (ev.bodyPreview || '').slice(0, 280).replace(/\s+/g, ' ').trim()
      const attendees   = extractAttendees(ev.subject || '', ev.bodyPreview || '')
      out.push({
        week:        wd.week,
        date:        startDt ? fmtDate(startDt) : '',
        startTime:   (startDt && !ev.isAllDay) ? fmtTime(startDt) : '',
        endTime:     (endDt   && !ev.isAllDay) ? fmtTime(endDt)   : '',
        durationHrs: durHrs,
        subject:     ev.subject || '',
        description: description,
        location:    (ev.location && ev.location.displayName) || '',
        attendees:   attendees,
        organizer:   orgName,
        allDay:      ev.isAllDay ? 'Y' : 'N',
        _sortKey:    startDt || '',
      })
    }
  }
  out.sort((a, b) => (a._sortKey > b._sortKey ? 1 : a._sortKey < b._sortKey ? -1 : 0))
  return out
}

// _SKILL_POST_PROCESS_V1: builds All Events sheet + per-type tabs from rules.
// Rules source priority: inlineRules (if object) > rulesPath (if string) > skip.
async function applyPostProcess (wb, weekResults, rulesPath, inlineRules, ExcelJS) {
  let rules
  if (inlineRules && typeof inlineRules === 'object') {
    rules = inlineRules
  } else if (rulesPath) {
    try {
      rules = JSON.parse(readFileSync(rulesPath, 'utf8'))
    } catch (e) {
      return { error: 'cannot read categorisation_rules_path: ' + e.message }
    }
  } else {
    return { skipped: true }
  }
  const FILL_DARK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  const FONT_HDR  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }

  let rows = _flattenWeeks(weekResults)

  // Dedup
  if (rules.dedup && rules.dedup.enabled) {
    const before = rows.length
    rows = _dedupRows(rows, rules.dedup.keys || ['date', 'normalised_subject'])
    if (before !== rows.length) {
      // Note dedup count in caller via return
    }
  }

  // Categorise
  for (const r of rows) {
    r.type = _categoryFor(r, rules)
  }

  // All Events sheet
  const allWs = wb.addWorksheet('All Events', { pageSetup: { orientation: 'landscape' } })
  allWs.columns = [
    { header: 'Week',         key: 'week',         width: 6  },
    { header: 'Date',         key: 'date',         width: 12 },
    { header: 'Start',        key: 'startTime',    width: 8  },
    { header: 'End',          key: 'endTime',      width: 8  },
    { header: 'Duration hrs', key: 'durationHrs',  width: 10 },
    { header: 'Type',         key: 'type',         width: 14 },
    { header: 'Subject',      key: 'subject',      width: 50 },
    { header: 'Description',  key: 'description',  width: 60 },
    { header: 'Location',     key: 'location',     width: 25 },
    { header: 'Attendees',    key: 'attendees',    width: 10 },
    { header: 'Organizer',    key: 'organizer',    width: 25 },
    { header: 'All Day',      key: 'allDay',       width: 7  },
  ]
  const allHdr = allWs.getRow(1); allHdr.fill = FILL_DARK; allHdr.font = FONT_HDR; allHdr.commit()
  for (const r of rows) allWs.addRow(r)

  // Per-type tabs
  const tabOrder = rules.tab_order || Object.keys(rules.categories || {})
  const perTypeStats = {}
  for (const tab of tabOrder) {
    const subset = rows.filter(r => r.type === tab)
    perTypeStats[tab] = subset.length
    if (subset.length === 0) continue
    const tWs = wb.addWorksheet(tab.slice(0, 31)) // Excel max sheet name 31 chars
    tWs.columns = [
      { header: 'Week',        key: 'week',        width: 6  },
      { header: 'Date',        key: 'date',        width: 12 },
      { header: 'Subject',     key: 'subject',     width: 50 },
      { header: 'Duration',    key: 'durationHrs', width: 10 },
      { header: 'Attendees',   key: 'attendees',   width: 10 },
      { header: 'Description', key: 'description', width: 70 },
      { header: 'Location',    key: 'location',    width: 25 },
    ]
    const h = tWs.getRow(1); h.fill = FILL_DARK; h.font = FONT_HDR; h.commit()
    for (const r of subset) tWs.addRow(r)
  }

  return { skipped: false, total_rows: rows.length, per_type: perTypeStats }
}

// ── Main exported entry point ──────────────────────────────────────────────────

export async function buildBoardPack (input, context) {
  // _SKILL_POST_PROCESS_V1: post-processing inputs added
  const { mailbox_tenant_key, period, output_dir, output_label, run_id,
          categorisation_rules_path, inline_rules, post_process, preset } = input
  const { getTenant } = context

  // _PRESET_LOAD_V1: load preset JSON when caller passes preset=<name>
  let _presetBrand         = null
  let _presetCoverFooter   = null
  let _resolvedOutputLabel = output_label || null
  if (preset) {
    if (!/^[a-z][a-z0-9-]{1,48}$/.test(preset)) {
      return { error: 'Invalid preset name "' + preset + '". Must match ^[a-z][a-z0-9-]{1,48}$.' }
    }
    const _presetPath = join(SKILL_DIR, 'presets', preset + '.json')
    if (!existsSync(_presetPath)) {
      return { error: 'Preset not found: ' + preset + '. Expected at ' + _presetPath }
    }
    try {
      const _p = JSON.parse(readFileSync(_presetPath, 'utf8'))
      _presetBrand        = (_p.brand && typeof _p.brand === 'object') ? _p.brand : null
      _presetCoverFooter  = (_p.defaults && _p.defaults.cover_footer) || null
      if (!_resolvedOutputLabel && _p.defaults && _p.defaults.output_label) _resolvedOutputLabel = _p.defaults.output_label
    } catch (e) {
      return { error: 'Failed to parse preset "' + preset + '": ' + e.message }
    }
  }

  if (!mailbox_tenant_key || typeof mailbox_tenant_key !== 'string') {
    return { error: 'mailbox_tenant_key is required (string). Caller supplies the mnemosyne MCP tenant key directly, e.g. "my-mailbox", "team-calendar".' }
  }

  const label    = safeLabel(_resolvedOutputLabel || mailbox_tenant_key)

  let periodParsed
  try { periodParsed = parsePeriod(period) }
  catch (e) { return { error: e.message } }

  const { year, startWeek, endWeek } = periodParsed

  const runId  = run_id || randomBytes(4).toString('hex')
  const runDir = join(RUNS_DIR, runId)
  const weeksDir = join(runDir, 'weeks')
  mkdirSync(weeksDir, { recursive: true })

  // Load or init state
  const statePath = join(runDir, 'state.json')
  let state = {
    run_id:             runId,
    mailbox_tenant_key,
    output_label:       label,
    period,
    completed_weeks:    [],
    started_at:         new Date().toISOString(),
    status:             'running',
  }
  if (existsSync(statePath)) {
    try {
      const saved = JSON.parse(readFileSync(statePath, 'utf8'))
      state = Object.assign(state, saved)
    } catch {}
  }
  state.status   = 'running'
  state.run_id   = runId

  const saveState = () => {
    try { writeFileSync(statePath, JSON.stringify(state, null, 2)) } catch {}
  }
  saveState()

  // ── Stage 1: Calendar pull ─────────────────────────────────────────────────

  let client
  try { client = getTenant(mailbox_tenant_key) }
  catch (e) { return { error: 'getTenant("' + mailbox_tenant_key + '") failed: ' + e.message } }

  const weekResults = []

  for (let w = startWeek; w <= endWeek; w++) {
    const wLabel = 'W' + String(w).padStart(2, '0')
    const wPath  = join(weeksDir, wLabel + '.json')

    if (state.completed_weeks.includes(wLabel) && existsSync(wPath)) {
      try {
        weekResults.push(JSON.parse(readFileSync(wPath, 'utf8')))
        continue
      } catch {}
    }

    const { start, end } = isoWeekRange(year, w)
    let events  = []
    let lastErr = null

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await client.callTool('get-calendar-view', {
          startDateTime: start,
          endDateTime:   end,
          top:           100,
          select:        'id,subject,start,end,location,organizer,attendees,bodyPreview,isAllDay',
          orderby:       'start/dateTime asc',
          timezone:      'Europe/London',
        })
        events  = (r && Array.isArray(r.value)) ? r.value : (Array.isArray(r) ? r : [])
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        if (attempt < 3) {
          await new Promise(res => setTimeout(res, 2000 * attempt))
        }
      }
    }

    if (lastErr) {
      state.status = 'failed'
      state.failed_week = wLabel
      state.error = lastErr.message
      saveState()
      return {
        error:      'Stage 1 failed at ' + wLabel + ' after 3 attempts: ' + lastErr.message,
        run_id:     runId,
        resume_hint: 'Call again with the same run_id to resume from ' + wLabel,
      }
    }

    const weekData = { week: wLabel, year, start, end, event_count: events.length, events }
    try { writeFileSync(wPath, JSON.stringify(weekData, null, 2)) } catch {}
    if (!state.completed_weeks.includes(wLabel)) state.completed_weeks.push(wLabel)
    saveState()
    weekResults.push(weekData)
  }

  // ── Stage 2: Xlsx assembly ─────────────────────────────────────────────────

  const xlsxPath = join(runDir, 'board-pack-' + label + '-' + period + '.xlsx')

  try {
    const wb = new ExcelJS.Workbook()
    wb.creator  = 'Pandoras Box - Muse'
    wb.created  = new Date()
    wb.modified = new Date()

    const FILL_DARK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    const FONT_HDR  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }

    const sumWs = wb.addWorksheet('Summary', { pageSetup: { orientation: 'landscape' } })
    sumWs.columns = [
      { header: 'Week',       key: 'week',        width: 8  },
      { header: 'Start',      key: 'start_date',  width: 14 },
      { header: 'End',        key: 'end_date',    width: 14 },
      { header: 'Events',     key: 'event_count', width: 10 },
    ]
    const sumHdr = sumWs.getRow(1)
    sumHdr.fill = FILL_DARK
    sumHdr.font = FONT_HDR
    sumHdr.commit()

    for (const wd of weekResults) {
      sumWs.addRow({
        week:        wd.week,
        start_date:  wd.start.slice(0, 10),
        end_date:    wd.end.slice(0, 10),
        event_count: wd.event_count,
      })
    }

    const sumExpected = weekResults.length
    const sumActual   = sumWs.rowCount - 1
    if (sumActual !== sumExpected) {
      throw new Error('ROW COUNT MISMATCH Summary: expected ' + sumExpected + ' got ' + sumActual)
    }

    for (const wd of weekResults) {
      const ws = wb.addWorksheet(wd.week)
      // _SKILL_ATTENDEES_FROM_DESC_V1: 10-col schema, Attendees from description (no array extrapolation).
      ws.columns = [
        { header: 'Date',         key: 'date',         width: 12 },
        { header: 'Start',        key: 'startTime',    width: 8  },
        { header: 'End',          key: 'endTime',      width: 8  },
        { header: 'Duration hrs', key: 'durationHrs',  width: 12 },
        { header: 'Subject',      key: 'subject',      width: 50 },
        { header: 'Description',  key: 'description',  width: 60 },
        { header: 'Location',     key: 'location',     width: 25 },
        { header: 'Attendees',    key: 'attendees',    width: 12 },
        { header: 'Organizer',    key: 'organizer',    width: 30 },
        { header: 'All Day',      key: 'allDay',       width: 8  },
      ]
      const wsHdr = ws.getRow(1)
      wsHdr.fill = FILL_DARK
      wsHdr.font = FONT_HDR
      wsHdr.commit()

      for (const ev of wd.events) {
        const startDt = ev.start && ev.start.dateTime ? ev.start.dateTime : null
        const endDt   = ev.end   && ev.end.dateTime   ? ev.end.dateTime   : null
        let durHrs = ''
        if (startDt && endDt) {
          const ms = new Date(endDt).getTime() - new Date(startDt).getTime()
          if (Number.isFinite(ms) && ms >= 0) durHrs = Math.round((ms / 3_600_000) * 100) / 100
        }
        const orgName = (ev.organizer && ev.organizer.emailAddress &&
                        (ev.organizer.emailAddress.name || ev.organizer.emailAddress.address)) || ''
        const description = (ev.bodyPreview || '').slice(0, 280).replace(/\s+/g, ' ').trim()
        const attendees   = extractAttendees(ev.subject || '', ev.bodyPreview || '')
        ws.addRow({
          date:        startDt ? fmtDate(startDt) : '',
          startTime:   (startDt && !ev.isAllDay) ? fmtTime(startDt) : '',
          endTime:     (endDt   && !ev.isAllDay) ? fmtTime(endDt)   : '',
          durationHrs: durHrs,
          subject:     ev.subject || '',
          description: description,
          location:    (ev.location && ev.location.displayName) || '',
          attendees:   attendees,
          organizer:   orgName,
          allDay:      ev.isAllDay ? 'Y' : 'N',
        })
      }

      const expected = wd.events.length
      const actual   = ws.rowCount - 1
      if (actual !== expected) {
        throw new Error('ROW COUNT MISMATCH ' + wd.week + ': expected ' + expected + ' got ' + actual)
      }
    }

    // _SKILL_POST_PROCESS_V1: Stage 4 post-processing (additive sheets) -- runs before writeFile.
    const _hasRules = !!categorisation_rules_path || (inline_rules && typeof inline_rules === 'object')
    const _shouldPostProc = post_process !== false && _hasRules
    if (_shouldPostProc) {
      try {
        const _ppRes = await applyPostProcess(wb, weekResults, categorisation_rules_path, inline_rules, ExcelJS)
        if (_ppRes && _ppRes.error) {
          state.post_process_error = _ppRes.error
        } else if (_ppRes) {
          state.post_process = _ppRes
        }
      } catch (_ppErr) {
        state.post_process_error = 'Stage 4: ' + _ppErr.message
      }
    }
    await wb.xlsx.writeFile(xlsxPath)
    state.xlsx_path = xlsxPath
    saveState()

  } catch (e) {
    state.status = 'failed'
    state.error  = 'Stage 2 (xlsx): ' + e.message
    saveState()
    return { error: state.error, run_id: runId }
  }

  // ── Stage 3: PDF render ────────────────────────────────────────────────────

  const htmlPath = join(runDir, 'board-pack.html')
  const pdfPath  = join(runDir, 'board-pack-' + label + '-' + period + '.pdf')

  try {
    const templateMod = await import(join(SKILL_DIR, 'board_pack_template.mjs'))
    const html = templateMod.generateHtml({ label, period, year, weekResults, brand: _presetBrand, cover_footer: _presetCoverFooter })
    writeFileSync(htmlPath, html, 'utf8')
  } catch (e) {
    state.status = 'failed'
    state.error  = 'Stage 3 HTML template: ' + e.message
    saveState()
    return { error: state.error, run_id: runId }
  }

  const chromeResult = spawnSync(CHROME, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--print-to-pdf=' + pdfPath,
    '--print-to-pdf-no-header',
    'file://' + htmlPath,
  ], { timeout: 90000 })

  if (chromeResult.status !== 0 || !existsSync(pdfPath)) {
    const stderr = chromeResult.stderr ? chromeResult.stderr.toString().slice(0, 300) : ''
    const stdout = chromeResult.stdout ? chromeResult.stdout.toString().slice(0, 300) : ''
    state.status = 'failed'
    state.error  = 'Chrome PDF failed (status ' + chromeResult.status + '): ' + stderr + stdout
    saveState()
    return { error: state.error, run_id: runId, xlsx_path: xlsxPath }
  }

  // _SKILL_XLSX_TO_OUTPUT_DIR_V1: also copy xlsx to output_dir alongside PDF.
  let finalPdf  = pdfPath
  let finalXlsx = xlsxPath
  if (output_dir && output_dir !== runDir) {
    try {
      mkdirSync(output_dir, { recursive: true })
      finalPdf  = join(output_dir, 'board-pack-' + label + '-' + period + '.pdf')
      finalXlsx = join(output_dir, 'board-pack-' + label + '-' + period + '.xlsx')
      copyFileSync(pdfPath,  finalPdf)
      copyFileSync(xlsxPath, finalXlsx)
    } catch (e) {
      finalPdf  = pdfPath
      finalXlsx = xlsxPath
    }
  }

  state.pdf_path     = finalPdf
  state.status       = 'complete'
  state.completed_at = new Date().toISOString()
  saveState()

  return {
    ok:                 true,
    run_id:             runId,
    mailbox_tenant_key,
    output_label:       label,
    period,
    weeks_processed:    weekResults.length,
    weeks_summary:      weekResults.map(w => ({ week: w.week, events: w.event_count, status: 'complete' })),
    xlsx_path:          finalXlsx,
    pdf_path:           finalPdf,
    run_dir:            runDir,
    post_process:       state.post_process || null,                  // _SKILL_POST_PROCESS_V1
    post_process_error: state.post_process_error || null,            // _SKILL_POST_PROCESS_V1
  }
}
