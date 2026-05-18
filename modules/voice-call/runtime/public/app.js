// pbox-voice-call browser client.
// PCM 16 kHz mono capture from mic, send over WSS to server, receive PCM 24 kHz
// mono from server (Gemini), play back via AudioContext.

const startBtn = document.getElementById('startBtn')
const endBtn   = document.getElementById('endBtn')
const status   = document.getElementById('status')
const meta     = document.getElementById('meta')
const transcript = document.getElementById('transcript')
const textInputBox = document.getElementById('textInputBox')
const textInput  = document.getElementById('textInput')
const sendText   = document.getElementById('sendText')

let ws = null
let mediaStream = null
let audioCtx = null
let processorNode = null
let playbackCtx = null
let playbackTime = 0
let audioInSec  = 0
let audioOutSec = 0

async function init () {
  try {
    const res = await fetch('/config')
    const cfg = await res.json()
    meta.textContent = `tenant=${cfg.slug} · model=${cfg.model} · voice=${cfg.voice}`
  } catch { meta.textContent = '(config fetch failed)' }
}
init()

function setStatus (s) { status.textContent = s }
function appendTranscript (role, text) {
  const li = document.createElement('li')
  const r  = document.createElement('span'); r.className = 'role'; r.textContent = role
  const t  = document.createElement('span'); t.textContent = text
  li.appendChild(r); li.appendChild(t)
  transcript.appendChild(li)
  transcript.scrollTop = transcript.scrollHeight
}

// 24 kHz PCM 16-bit -> AudioBuffer
function decodePcm (pcmBytes, sampleRate) {
  const view = new DataView(pcmBytes)
  const samples = pcmBytes.byteLength / 2
  const buf = playbackCtx.createBuffer(1, samples, sampleRate)
  const ch  = buf.getChannelData(0)
  for (let i = 0; i < samples; i++) {
    ch[i] = view.getInt16(i * 2, true) / 32768
  }
  return buf
}

function playPcmChunk (arrayBuffer) {
  if (!playbackCtx) playbackCtx = new AudioContext({ sampleRate: 24000 })
  const buf = decodePcm(arrayBuffer, 24000)
  const src = playbackCtx.createBufferSource()
  src.buffer = buf
  src.connect(playbackCtx.destination)
  const startAt = Math.max(playbackCtx.currentTime, playbackTime)
  src.start(startAt)
  playbackTime = startAt + buf.duration
  audioOutSec += buf.duration
  refreshCostEst()
}

function refreshCostEst () {
  const ce = document.getElementById('costEst')
  // Rates are best-effort defaults (rate-card-2025-q4). The server's
  // /store/voice-call-cost.jsonl has the authoritative number.
  const est = (audioInSec * 0.000150 + audioOutSec * 0.000600)
  ce.textContent = `cost est ~ $${est.toFixed(4)}`
}

async function startCall () {
  startBtn.disabled = true
  setStatus('connecting…')

  // Open WSS first.
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/call/ws'
  ws = new WebSocket(wsUrl)
  ws.binaryType = 'arraybuffer'

  await new Promise((resolve, reject) => {
    ws.onopen  = resolve
    ws.onerror = reject
  })

  // Mic capture, 16 kHz PCM
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })
  audioCtx = new AudioContext({ sampleRate: 16000 })
  const src = audioCtx.createMediaStreamSource(mediaStream)

  // ScriptProcessor is deprecated but still the most-portable PCM tap.
  processorNode = audioCtx.createScriptProcessor(4096, 1, 1)
  processorNode.onaudioprocess = (ev) => {
    if (ws.readyState !== WebSocket.OPEN) return
    const inBuf = ev.inputBuffer.getChannelData(0)
    const out = new Int16Array(inBuf.length)
    for (let i = 0; i < inBuf.length; i++) {
      const s = Math.max(-1, Math.min(1, inBuf[i]))
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    ws.send(out.buffer)
    audioInSec += inBuf.length / 16000
  }
  src.connect(processorNode)
  processorNode.connect(audioCtx.destination)

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      playPcmChunk(ev.data)
      return
    }
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.type === 'ready')         setStatus('call live')
    if (msg.type === 'transcript')    appendTranscript(msg.role, msg.text)
    if (msg.type === 'turn_complete') {/* visual cue could go here */}
    if (msg.type === 'error')         { setStatus('error: ' + msg.error); endCall() }
  }
  ws.onclose = () => { setStatus('disconnected'); cleanup() }

  endBtn.disabled = false
  textInputBox.hidden = false
  setStatus('listening')
}

function endCall () {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'end_call' }))
  cleanup()
}

function cleanup () {
  try { processorNode?.disconnect() } catch {}
  try { audioCtx?.close()            } catch {}
  try { mediaStream?.getTracks().forEach(t => t.stop()) } catch {}
  try { ws?.close()                  } catch {}
  startBtn.disabled = false
  endBtn.disabled   = true
  textInputBox.hidden = true
}

startBtn.addEventListener('click', startCall)
endBtn  .addEventListener('click', endCall)
sendText.addEventListener('click', () => {
  const t = textInput.value.trim()
  if (!t || ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'text_input', text: t }))
  appendTranscript('user', t)
  textInput.value = ''
})
