#!/usr/bin/env node
// pbox-vault-graph.mjs -- renders the assistant's memory as an Obsidian vault on
// disk: pinned facts, conversation threads, and an index that links them so
// Obsidian's graph view shows the relationships. Regenerates on a timer; agents
// and you can read/write the same notes. _VAULT_GRAPH_V1
//
//   pbox-vault-graph --once    # render once and exit (used by tests/installer)
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const INTERVAL_SEC = parseInt(process.env.VAULT_GRAPH_INTERVAL_SEC || '600', 10)
const VAULT_DIR = process.env.VAULT_GRAPH_DIR || path.join(INSTALL_PATH, 'vault-graph', 'vault')

function resolveMemoryDb () {
  if (process.env.PBOX_MEMORY_DB) return process.env.PBOX_MEMORY_DB
  for (const p of [path.join(INSTALL_PATH, 'personal-ai', 'store', 'memory.db'),
                   path.join(INSTALL_PATH, 'data', 'personal-ai', 'memory.db')]) {
    if (fs.existsSync(p)) return p
  }
  return path.join(INSTALL_PATH, 'personal-ai', 'store', 'memory.db')
}
const MEMORY_DB = resolveMemoryDb()

const safe = s => String(s || 'untitled').replace(/[\/\\:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled'
const esc = s => String(s == null ? '' : s)

function render () {
  fs.mkdirSync(path.join(VAULT_DIR, 'Threads'), { recursive: true })
  let facts = [], convos = []
  if (fs.existsSync(MEMORY_DB)) {
    try {
      const db = new DatabaseSync(MEMORY_DB)
      try { facts = db.prepare('SELECT fact FROM important_facts ORDER BY id DESC LIMIT 1000').all().map(r => r.fact) } catch {}
      try { convos = db.prepare('SELECT id, title FROM conversations ORDER BY last_msg_at DESC LIMIT 500').all() } catch {}
      // per-thread messages
      const msgStmt = (() => { try { return db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC') } catch { return null } })()
      const threadLinks = []
      for (const c of convos) {
        const title = safe(c.title || ('Conversation ' + c.id))
        threadLinks.push(title)
        let body = `# ${esc(c.title || ('Conversation ' + c.id))}\n\n[[index]]\n\n`
        if (msgStmt) {
          try { for (const m of msgStmt.all(c.id)) body += `**${esc(m.role)}:** ${esc(m.content)}\n\n` } catch {}
        }
        fs.writeFileSync(path.join(VAULT_DIR, 'Threads', title + '.md'), body)
      }
      db.close()
      // Facts note
      fs.writeFileSync(path.join(VAULT_DIR, 'Facts.md'),
        `# Facts\n\n[[index]]\n\n` + (facts.length ? facts.map(f => '- ' + esc(f)).join('\n') : '_No pinned facts yet._') + '\n')
      // index linking everything (this is the graph)
      const idx = `# ${esc(process.env.SYSTEM_NAME || "Pandora's Box")} — Memory\n\n` +
        `Auto-generated from your assistant's memory. Open this vault in Obsidian and use the graph view.\n\n` +
        `## Pinned facts\n[[Facts]] (${facts.length})\n\n` +
        `## Threads\n` + (threadLinks.length ? threadLinks.map(t => `- [[Threads/${t}|${t}]]`).join('\n') : '_No conversations yet._') + '\n'
      fs.writeFileSync(path.join(VAULT_DIR, 'index.md'), idx)
      return { facts: facts.length, threads: threadLinks.length }
    } catch (e) {
      fs.writeFileSync(path.join(VAULT_DIR, 'index.md'), `# Memory\n\n_Could not read memory.db: ${esc(e.message)}_\n`)
      return { error: e.message }
    }
  }
  fs.writeFileSync(path.join(VAULT_DIR, 'index.md'), `# Memory\n\n_No memory yet (personal-ai not installed or empty)._\n`)
  return { facts: 0, threads: 0 }
}

const once = process.argv.includes('--once')
const r = render()
console.log(`[vault-graph] rendered ${VAULT_DIR}`, JSON.stringify(r))
if (!once) {
  setInterval(() => { try { const x = render(); console.log('[vault-graph] re-rendered', JSON.stringify(x)) } catch (e) { console.log('[vault-graph] render error', e.message) } }, INTERVAL_SEC * 1000)
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0))
}
