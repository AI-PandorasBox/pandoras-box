/* Personal AI client-side app. SSE streaming, conversation list, facts, drops. */
(function () {
  'use strict'

  const VOICE_ENABLED = document.querySelector('meta[name="pbox-voice"]')?.content === '1'
  const TTS_ENABLED = document.querySelector('meta[name="pbox-tts"]')?.content === '1'

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'))
    return m ? decodeURIComponent(m[1]) : null
  }

  function csrfHeaders() {
    const t = getCookie('pai_csrf')
    return t ? { 'x-csrf-token': t } : {}
  }

  async function apiGet(path) {
    const r = await fetch(path, { credentials: 'same-origin' })
    if (!r.ok) throw new Error('GET ' + path + ' -> ' + r.status)
    return r.json()
  }

  async function apiPost(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(body || {}),
    })
    if (!r.ok) {
      let detail = ''
      try { detail = (await r.json()).error || '' } catch {}
      throw new Error('POST ' + path + ' -> ' + r.status + (detail ? ' ' + detail : ''))
    }
    return r.json()
  }

  const state = {
    conversationId: null,
    conversations: [],
    streaming: false,
  }

  const el = {
    messages: document.getElementById('messages'),
    input: document.getElementById('input'),
    composer: document.getElementById('composer'),
    send: document.getElementById('send'),
    newConv: document.getElementById('new-conv'),
    convList: document.getElementById('conv-list'),
    convTitle: document.getElementById('conv-title'),
    status: document.getElementById('status'),
    logout: document.getElementById('logout'),
    factsDialog: document.getElementById('facts-dialog'),
    factsList: document.getElementById('facts-list'),
    addFactForm: document.getElementById('add-fact-form'),
    newFact: document.getElementById('new-fact'),
    showFacts: document.getElementById('show-facts'),
    dropsDialog: document.getElementById('drops-dialog'),
    dropsList: document.getElementById('drops-list'),
    addDropForm: document.getElementById('add-drop-form'),
    dropPath: document.getElementById('drop-path'),
    dropKind: document.getElementById('drop-kind'),
    showDrops: document.getElementById('show-drops'),
    mic: document.getElementById('mic'),
  }

  function buildMeta(msg) {
    const meta = document.createElement('div')
    meta.className = 'meta'
    const up = document.createElement('button')
    up.textContent = 'helpful'
    up.onclick = () => rateMessage(msg.id, 1, up)
    const dn = document.createElement('button')
    dn.textContent = 'not helpful'
    dn.onclick = () => rateMessage(msg.id, -1, dn)
    const copy = document.createElement('button')
    copy.textContent = 'copy'
    copy.onclick = () => navigator.clipboard?.writeText(msg.content)
    const pin = document.createElement('button')
    pin.textContent = 'pin fact'
    pin.onclick = () => pinAsFact(msg)
    meta.append(up, dn, copy, pin)
    if (TTS_ENABLED) {
      const speak = document.createElement('button')
      speak.textContent = 'speak'
      speak.onclick = () => speakText(msg.content, speak)
      meta.appendChild(speak)
    }
    return meta
  }

  function renderMessage(msg) {
    const div = document.createElement('div')
    div.className = 'msg ' + (msg.role === 'user' ? 'user' : 'assistant')
    if (msg.id) div.dataset.id = String(msg.id)
    const content = document.createElement('div')
    content.textContent = String(msg.content || '')
    div.appendChild(content)
    if (msg.role === 'assistant' && msg.id) {
      div.appendChild(buildMeta(msg))
    }
    el.messages.appendChild(div)
    el.messages.scrollTop = el.messages.scrollHeight
    return div
  }

  async function rateMessage(id, rating, btn) {
    if (!id) return
    try {
      await apiPost('/api/messages/' + id + '/rate', { rating })
      if (btn) btn.style.color = 'var(--accent)'
    } catch (e) { console.warn(e) }
  }

  async function pinAsFact(msg) {
    const fact = prompt('Pin a fact extracted from this message:', msg.content.slice(0, 200))
    if (!fact) return
    try {
      await apiPost('/api/important_facts', { fact, source_message_id: msg.id })
      setStatus('Pinned')
    } catch (e) { setStatus('Pin failed') }
  }

  async function speakText(text, btn) {
    btn.disabled = true
    const orig = btn.textContent
    btn.textContent = 'loading...'
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ text }),
      })
      if (!r.ok) throw new Error('tts ' + r.status)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      audio.play()
    } catch (e) { setStatus('TTS failed') }
    finally { btn.disabled = false; btn.textContent = orig }
  }

  function setStatus(s) {
    el.status.textContent = s || ''
    if (s) setTimeout(() => { if (el.status.textContent === s) el.status.textContent = '' }, 4000)
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
  }

  function renderConversationList() {
    clearChildren(el.convList)
    for (const c of state.conversations) {
      const div = document.createElement('div')
      div.className = 'conv-item'
      if (c.id === state.conversationId) div.classList.add('active')
      div.textContent = c.title || ('Conversation ' + c.id)
      div.title = new Date(c.last_msg_at).toLocaleString()
      div.onclick = () => openConversation(c.id)
      el.convList.appendChild(div)
    }
  }

  async function loadConversations() {
    try {
      const r = await apiGet('/api/conversations')
      state.conversations = r.conversations || []
      renderConversationList()
    } catch (e) { console.warn(e) }
  }

  async function openConversation(id) {
    state.conversationId = id
    clearChildren(el.messages)
    renderConversationList()
    try {
      const r = await apiGet('/api/conversations/' + id + '/messages')
      const conv = state.conversations.find(c => c.id === id)
      el.convTitle.textContent = conv ? (conv.title || ('Conversation ' + id)) : ('Conversation ' + id)
      for (const m of (r.messages || [])) renderMessage(m)
    } catch (e) { console.warn(e) }
  }

  function newConversation() {
    state.conversationId = null
    clearChildren(el.messages)
    el.convTitle.textContent = 'New chat'
    renderConversationList()
    el.input.focus()
  }

  el.newConv.addEventListener('click', newConversation)

  el.composer.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (state.streaming) return
    const text = el.input.value.trim()
    if (!text) return
    el.input.value = ''
    state.streaming = true
    el.send.disabled = true
    renderMessage({ role: 'user', content: text })
    const assistantDiv = renderMessage({ role: 'assistant', content: '' })
    const contentDiv = assistantDiv.firstChild
    setStatus('Thinking...')
    try {
      const params = new URLSearchParams({ content: text })
      if (state.conversationId) params.set('conversation_id', String(state.conversationId))
      const es = new EventSource('/api/chat/stream?' + params.toString(), { withCredentials: true })
      let acc = ''
      let messageId = null
      es.addEventListener('start', (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.conversation_id && !state.conversationId) {
            state.conversationId = data.conversation_id
          }
        } catch {}
      })
      es.addEventListener('token', (ev) => {
        try {
          const data = JSON.parse(ev.data)
          acc += data.text || ''
          contentDiv.textContent = acc
          el.messages.scrollTop = el.messages.scrollHeight
        } catch {}
      })
      es.addEventListener('end', (ev) => {
        try {
          const data = JSON.parse(ev.data)
          messageId = data.message_id
        } catch {}
        es.close()
        finishStream(assistantDiv, { id: messageId, role: 'assistant', content: acc })
      })
      es.addEventListener('error', () => {
        es.close()
        finishStream(assistantDiv, { id: null, role: 'assistant', content: acc || '(error)' })
        setStatus('Stream error')
      })
    } catch (err) {
      setStatus('Send failed: ' + err.message)
      state.streaming = false
      el.send.disabled = false
    }
  })

  function finishStream(node, msg) {
    state.streaming = false
    el.send.disabled = false
    setStatus('')
    clearChildren(node)
    const c = document.createElement('div')
    c.textContent = msg.content
    node.appendChild(c)
    if (msg.id) {
      node.dataset.id = String(msg.id)
      node.appendChild(buildMeta(msg))
    }
    loadConversations()
  }

  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      el.composer.requestSubmit()
    }
  })

  el.logout.addEventListener('click', async () => {
    try { await apiPost('/api/logout', {}) } catch {}
    location.href = '/'
  })

  el.showFacts.addEventListener('click', async () => {
    await refreshFacts()
    el.factsDialog.showModal()
  })
  async function refreshFacts() {
    try {
      const r = await apiGet('/api/important_facts')
      clearChildren(el.factsList)
      for (const f of (r.facts || [])) {
        const li = document.createElement('li')
        li.textContent = f.fact
        el.factsList.appendChild(li)
      }
    } catch (e) { console.warn(e) }
  }
  el.addFactForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fact = el.newFact.value.trim()
    if (!fact) return
    try {
      await apiPost('/api/important_facts', { fact })
      el.newFact.value = ''
      await refreshFacts()
    } catch (e2) { setStatus('Add fact failed') }
  })

  el.showDrops.addEventListener('click', async () => {
    await refreshDrops()
    el.dropsDialog.showModal()
  })
  async function refreshDrops() {
    try {
      const r = await apiGet('/api/drops')
      clearChildren(el.dropsList)
      for (const d of (r.drops || [])) {
        const li = document.createElement('li')
        li.textContent = '[' + d.kind + '] ' + d.content_path
        el.dropsList.appendChild(li)
      }
    } catch (e) { console.warn(e) }
  }
  el.addDropForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const kind = el.dropKind.value
    const content_path = el.dropPath.value.trim()
    if (!content_path) return
    try {
      await apiPost('/api/drops', { kind, content_path })
      el.dropPath.value = ''
      await refreshDrops()
    } catch (e2) { setStatus('Add drop failed') }
  })

  document.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', () => b.closest('dialog').close())
  })

  if (VOICE_ENABLED) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SR) {
      el.mic.hidden = false
      const rec = new SR()
      rec.continuous = false
      rec.interimResults = false
      rec.lang = navigator.language || 'en-GB'
      let listening = false
      el.mic.addEventListener('click', () => {
        if (listening) { rec.stop(); return }
        try { rec.start(); listening = true; el.mic.textContent = 'Stop' } catch {}
      })
      rec.onresult = (ev) => {
        const t = Array.from(ev.results).map(r => r[0].transcript).join('')
        el.input.value = (el.input.value + ' ' + t).trim()
      }
      rec.onend = () => { listening = false; el.mic.textContent = 'Mic' }
      rec.onerror = () => { listening = false; el.mic.textContent = 'Mic' }
    }
  }

  loadConversations()
})()
