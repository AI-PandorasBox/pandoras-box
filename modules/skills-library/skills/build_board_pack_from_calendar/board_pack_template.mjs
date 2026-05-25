// Board pack HTML template -- _SKILL_TENANT_AGNOSTIC_V1
// Generates print-ready HTML for Chrome headless PDF.
// Called by skill.mjs Stage 3. Kept in a separate file to avoid template-literal
// injection issues in patch scripts.
//
// Tenant-agnostic: takes a single `label` string for the cover line. Caller
// supplies whatever display string they want shown on the PDF.

function esc (str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate (isoStr) {
  if (!isoStr) return ''
  try {
    return new Date(isoStr).toLocaleDateString('en-GB', {
      timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
    })
  } catch { return isoStr.slice(0, 10) }
}

function fmtTime (isoStr, isAllDay) {
  if (isAllDay) return 'All Day'
  if (!isoStr)  return ''
  try {
    return new Date(isoStr).toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit',
    })
  } catch { return isoStr.slice(11, 16) }
}

export function generateHtml ({ label, period, year, weekResults, brand, cover_footer }) {
  const cover        = esc(label || 'Board Pack')
  // _PRESET_LOAD_V1: brand colours with fallback to defaults
  const _PRIMARY   = (brand && brand.colors && brand.colors.primary)   || '#1F3864'
  const _SECONDARY = (brand && brand.colors && brand.colors.secondary) || '#2E4057'
  const _ACCENT    = (brand && brand.colors && brand.colors.accent)    || '#C9A961'
  const _BG        = (brand && brand.colors && brand.colors.bg)        || '#ffffff'
  const _TEXT      = (brand && brand.colors && brand.colors.text)      || '#1a1a1a'
  const generatedAt  = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  const totalEvents  = weekResults.reduce((s, w) => s + w.event_count, 0)

  const summaryRows = weekResults.map(wd => {
    return '<tr><td>' + esc(wd.week) + '</td><td>' + esc(wd.start.slice(0, 10)) +
           '</td><td>' + esc(wd.end.slice(0, 10)) + '</td><td>' + wd.event_count + '</td></tr>'
  }).join('\n')

  const weekSections = weekResults.map(wd => {
    const rows = wd.events.map(ev => {
      const startDt = ev.start && ev.start.dateTime ? ev.start.dateTime : null
      const org = ev.organizer && ev.organizer.emailAddress
        ? (ev.organizer.emailAddress.name || ev.organizer.emailAddress.address || '')
        : ''
      return '<tr>' +
        '<td>' + (startDt ? fmtDate(startDt) : '') + '</td>' +
        '<td>' + (startDt ? fmtTime(startDt, ev.isAllDay) : '') + '</td>' +
        '<td>' + esc(ev.subject) + '</td>' +
        '<td>' + esc((ev.location && ev.location.displayName) || '') + '</td>' +
        '<td>' + esc(org) + '</td>' +
        '</tr>'
    }).join('\n')

    const eventsTable = wd.events.length > 0
      ? '<table><thead><tr><th>Date</th><th>Time</th><th>Subject</th><th>Location</th><th>Organizer</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
      : '<p class="no-events">No events this week.</p>'

    return '<section class="week">' +
      '<h2>' + esc(wd.week) + ' &mdash; ' + esc(wd.start.slice(0, 10)) + ' to ' + esc(wd.end.slice(0, 10)) +
      ' <span class="ev-count">(' + wd.event_count + ' event' + (wd.event_count !== 1 ? 's' : '') + ')</span></h2>' +
      eventsTable +
      '</section>'
  }).join('\n')

  return '<!DOCTYPE html>\n' +
    '<html lang="en"><head><meta charset="UTF-8">\n' +
    '<title>Board Pack - ' + cover + ' - ' + esc(period) + '</title>\n' +
    '<style>\n' +
    '  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: ' + _TEXT + '; margin: 0; padding: 24px; }\n' +
    '  h1 { font-size: 16pt; color: ' + _PRIMARY + '; border-bottom: 2px solid ' + _PRIMARY + '; padding-bottom: 6px; margin-bottom: 4px; }\n' +
    '  .meta { color: #555; font-size: 9pt; margin-bottom: 18px; }\n' +
    '  h2 { font-size: 12pt; color: ' + _SECONDARY + '; margin-top: 22px; margin-bottom: 6px; border-left: 3px solid ' + _SECONDARY + '; padding-left: 8px; }\n' +
    '  .ev-count { font-weight: normal; font-size: 10pt; color: #666; }\n' +
    '  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9pt; }\n' +
    '  th { background: ' + _PRIMARY + '; color: #fff; padding: 5px 8px; text-align: left; white-space: nowrap; }\n' +
    '  td { padding: 4px 8px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }\n' +
    '  tr:nth-child(even) td { background: #f4f6fb; }\n' +
    '  .no-events { color: #999; font-style: italic; padding: 4px 0; }\n' +
    '  .week { page-break-inside: avoid; }\n' +
    '  .summary-section { margin-bottom: 28px; }\n' +
    '  @page { margin: 20mm 15mm; }\n' +
    '  @media print { body { padding: 0; } }\n' +
    '</style></head>\n' +
    '<body>\n' +
    '<h1>Board Pack &mdash; ' + cover + '</h1>\n' +
    '<p class="meta">Period: ' + esc(period) + ' &nbsp;|&nbsp; ' +
    'Weeks: ' + weekResults.length + ' &nbsp;|&nbsp; ' +
    'Total events: ' + totalEvents + ' &nbsp;|&nbsp; ' +
    'Generated: ' + esc(generatedAt) + '</p>\n' +
    '<div class="summary-section">\n' +
    '<h2>Summary</h2>\n' +
    '<table><thead><tr><th>Week</th><th>Start</th><th>End</th><th>Events</th></tr></thead><tbody>\n' +
    summaryRows + '\n</tbody></table>\n</div>\n' +
    weekSections + '\n' +
    (cover_footer ? '<p class="cover-footer" style="margin-top:32px;font-size:8.5pt;color:#666;border-top:1px solid #ccc;padding-top:8px;">' + esc(cover_footer) + '</p>' : '') +
    '</body></html>'
}
