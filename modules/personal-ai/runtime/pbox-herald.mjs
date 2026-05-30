#!/usr/bin/env node
// pbox-herald.mjs -- Herald: Telegram relay for the Personal Assistant.
// Long-polls Telegram getUpdates and bridges each message to the assistant's
// /api/relay-chat endpoint (shared-secret auth), then sends the reply back to
// Telegram. No external dependencies. Single-chat allowlist supported.
import process from 'node:process'

const TOKEN  = process.env.TELEGRAM_BOT_TOKEN || ''
const ALLOW  = (process.env.TELEGRAM_CHAT_ID || '').trim()
const SECRET = process.env.HERALD_SECRET || ''
const PA_URL = (process.env.PERSONAL_AI_URL || 'http://127.0.0.1:8800').replace(/\/$/, '')
const API    = `https://api.telegram.org/bot${TOKEN}`

if (!TOKEN || !SECRET) {
  console.error('[herald] missing TELEGRAM_BOT_TOKEN or HERALD_SECRET -- exiting')
  process.exit(1)
}

async function tg (method, body) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  return r.json()
}
async function sendMsg (chatId, text) {
  // Telegram caps messages at ~4096 chars; chunk long replies.
  const s = String(text || '')
  for (let i = 0; i < s.length || i === 0; i += 4000) {
    await tg('sendMessage', { chat_id: chatId, text: s.slice(i, i + 4000) || '(empty)' })
    if (s.length <= 4000) break
  }
}
async function ask (text) {
  try {
    const r = await fetch(`${PA_URL}/api/relay-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-herald-secret': SECRET },
      body: JSON.stringify({ text })
    })
    const j = await r.json()
    return j.reply || j.error || '(no reply)'
  } catch (e) { return 'Assistant unavailable: ' + e.message }
}

let offset = 0
async function loop () {
  try {
    const r = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}`)
    const j = await r.json()
    if (j.ok) {
      for (const u of j.result) {
        offset = u.update_id + 1
        const m = u.message
        if (!m || !m.text) continue
        const chatId = String(m.chat.id)
        if (ALLOW && chatId !== ALLOW) { await sendMsg(chatId, 'Not authorised for this assistant.'); continue }
        await tg('sendChatAction', { chat_id: chatId, action: 'typing' })
        await sendMsg(chatId, await ask(m.text))
      }
    }
  } catch (e) {
    console.error('[herald] poll error:', e.message)
    await new Promise(res => setTimeout(res, 3000))
  }
  setImmediate(loop)
}

console.log('[herald] Telegram relay -> ' + PA_URL + (ALLOW ? ' (chat allowlist active)' : ' (no allowlist -- responds to anyone who finds the bot)'))
loop()
