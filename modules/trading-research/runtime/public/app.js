// app.js -- SSE client + table renderer. Read-only by design.
// All server-supplied values are passed through escapeHtml() before injection
// to prevent XSS even though the data comes from a trusted localhost API.

const $ = sel => document.querySelector(sel)

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtNum(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '-'
  const v = Number(n)
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function setTbody(selector, html) {
  // Single chokepoint for table-body updates. Callers MUST escape user data
  // via escapeHtml before passing it here.
  const tbody = document.querySelector(selector)
  if (tbody) tbody.innerHTML = html
}

function renderAccounts(rows) {
  if (!rows.length) {
    setTbody('#accounts-table tbody', '<tr><td colspan="7" class="empty">No accounts.</td></tr>')
    return
  }
  const html = rows.map(a =>
    '<tr>' +
    '<td><code>' + escapeHtml(a.accountId) + '</code></td>' +
    '<td>' + escapeHtml(a.accountName) + '</td>' +
    '<td>' + escapeHtml(a.accountType) + '</td>' +
    '<td>' + escapeHtml(a.currency) + '</td>' +
    '<td>' + escapeHtml(fmtNum(a.balance)) + '</td>' +
    '<td>' + escapeHtml(fmtNum(a.available)) + '</td>' +
    '<td>' + escapeHtml(fmtNum(a.profitLoss)) + '</td>' +
    '</tr>'
  ).join('')
  setTbody('#accounts-table tbody', html)
}

function renderPositions(rows) {
  if (!rows.length) {
    setTbody('#positions-table tbody', '<tr><td colspan="8" class="empty">No positions.</td></tr>')
    return
  }
  const html = rows.map(p =>
    '<tr>' +
    '<td>' + escapeHtml(p.instrument) + '</td>' +
    '<td><code>' + escapeHtml(p.epic) + '</code></td>' +
    '<td>' + escapeHtml(p.direction) + '</td>' +
    '<td>' + escapeHtml(fmtNum(p.size, 2)) + '</td>' +
    '<td>' + escapeHtml(fmtNum(p.openLevel, 4)) + '</td>' +
    '<td>' + escapeHtml(fmtNum(p.bid, 4)) + '</td>' +
    '<td>' + escapeHtml(fmtNum(p.offer, 4)) + '</td>' +
    '<td>' + escapeHtml(p.createdDate || '') + '</td>' +
    '</tr>'
  ).join('')
  setTbody('#positions-table tbody', html)
}

function renderSignals(rows) {
  if (!rows.length) {
    setTbody('#signals-table tbody',
      '<tr><td colspan="6" class="empty">Add epics to watchlist.json (under trading-research/store/).</td></tr>')
    return
  }
  const html = rows.map(s => {
    const cls = 'signal-' + escapeHtml(String(s.signal || ''))
    return '<tr>' +
      '<td><code>' + escapeHtml(s.epic) + '</code></td>' +
      '<td class="' + cls + '">' + escapeHtml(s.signal) + '</td>' +
      '<td>' + escapeHtml(fmtNum(s.ma50, 4)) + '</td>' +
      '<td>' + escapeHtml(fmtNum(s.ma200, 4)) + '</td>' +
      '<td>' + escapeHtml(s.samples != null ? String(s.samples) : '-') + '</td>' +
      '<td>' + escapeHtml(s.asOf || '') + '</td>' +
      '</tr>'
  }).join('')
  setTbody('#signals-table tbody', html)
}

function applySnapshot(snap) {
  if (!snap) return
  renderAccounts(snap.accounts || [])
  renderPositions(snap.positions || [])
  renderSignals(snap.signals || [])
  const lu = document.querySelector('#last-updated')
  lu.textContent = snap.last_updated_at ? 'updated ' + snap.last_updated_at : 'no data yet'
  const status = document.querySelector('#status')
  if (snap.last_error) {
    status.textContent = 'error: ' + snap.last_error
    status.className = 'status-err'
  } else {
    status.textContent = 'live (demo)'
    status.className = 'status-ok'
  }
}

function connect() {
  const es = new EventSource('/api/stream')
  es.addEventListener('snapshot', ev => {
    try { applySnapshot(JSON.parse(ev.data)) } catch {}
  })
  es.onerror = () => {
    const status = document.querySelector('#status')
    status.textContent = 'disconnected -- retrying'
    status.className = 'status-err'
    // EventSource auto-reconnects; nothing to do here.
  }
}

connect()
