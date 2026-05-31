#!/usr/bin/env node
// mcp-tool-proxy.mjs -- Generic MCP stdio server for claude-bridge
// Reads CALLBACK_URL and TOOLS_PATH from env.
// tools/list: returns tool definitions from TOOLS_PATH.
// tools/call: POSTs { name, args } to CALLBACK_URL and returns result.
//
// _MCP_BRIDGE_V1

import { readFileSync }  from 'node:fs'
import { createInterface } from 'node:readline'

const CALLBACK_URL = process.env.CALLBACK_URL || ''
const TOOLS_PATH   = process.env.TOOLS_PATH   || ''

let tools = []
if (TOOLS_PATH) {
  try {
    tools = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'))
  } catch (e) {
    process.stderr.write(`[mcp-tool-proxy] failed to load tools from ${TOOLS_PATH}: ${e.message}\n`)
  }
}

const rl = createInterface({ input: process.stdin, terminal: false })

function sendResult (id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function sendError (id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let msg
  try { msg = JSON.parse(trimmed) } catch { return }

  // Notifications have no id -- no response expected
  if (msg.id === undefined || msg.id === null) return

  switch (msg.method) {
    case 'initialize':
      sendResult(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities:    { tools: {} },
        serverInfo:      { name: 'mcp-tool-proxy', version: '1.0.0' },
      })
      break

    case 'tools/list':
      sendResult(msg.id, { tools })
      break

    case 'tools/call': {
      const { name, arguments: args } = msg.params || {}
      if (!CALLBACK_URL) {
        sendResult(msg.id, {
          content:  [{ type: 'text', text: 'Error: CALLBACK_URL not configured' }],
          isError:  true,
        })
        break
      }
      try {
        const r = await fetch(CALLBACK_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name, args: args || {} }),
          signal:  AbortSignal.timeout(45_000),
        })
        if (!r.ok) throw new Error(`Callback HTTP ${r.status}`)
        const d   = await r.json()
        let raw = d.result
        // _MCP_IMAGE_PARSE_V1 -- _wrapToolResult wraps tool returns as a JSON STRING, not object.
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw) } catch {}
        }

        // _MCP_IMAGE_CONTENT_V1 -- detect image content blocks in tool results
        // Supports: {data_url: 'data:image/...'} OR {_vision: {media_type, base64}} OR {images: [...]}
        const contentBlocks = []
        let imageEmitted = false
        if (raw && typeof raw === 'object') {
          // Case A: data_url field
          if (typeof raw.data_url === 'string' && raw.data_url.startsWith('data:image/')) {
            const m = raw.data_url.match(/^data:(image\/[^;]+);base64,(.+)$/)
            if (m) {
              const meta = { ...raw }
              delete meta.data_url
              contentBlocks.push({ type: 'text', text: JSON.stringify(meta).slice(0, 1500) })
              contentBlocks.push({ type: 'image', data: m[2], mimeType: m[1] })   // _MCP_IMAGE_FORMAT_V1
              imageEmitted = true
            }
          }
          // Case B: explicit _vision wrapper
          else if (raw._vision && raw._vision.base64 && raw._vision.media_type) {
            const meta = { ...raw }; delete meta._vision
            contentBlocks.push({ type: 'text', text: JSON.stringify(meta).slice(0, 1500) })
            contentBlocks.push({ type: 'image', data: raw._vision.base64, mimeType: raw._vision.media_type })   // _MCP_IMAGE_FORMAT_V1
            imageEmitted = true
          }
          // Case C: array of images
          else if (Array.isArray(raw.images)) {
            const meta = { ...raw }; delete meta.images
            contentBlocks.push({ type: 'text', text: JSON.stringify(meta).slice(0, 1500) })
            for (const img of raw.images.slice(0, 8)) {
              if (img && img.data_url) {
                const m = img.data_url.match(/^data:(image\/[^;]+);base64,(.+)$/)
                if (m) contentBlocks.push({ type: 'image', data: m[2], mimeType: m[1] })   // _MCP_IMAGE_FORMAT_V1
              }
            }
            imageEmitted = contentBlocks.some(c => c.type === 'image')
          }
        }

        if (imageEmitted) {
          sendResult(msg.id, { content: contentBlocks })
        } else {
          const txt = typeof raw === 'string' ? raw : JSON.stringify(raw ?? d)
          sendResult(msg.id, { content: [{ type: 'text', text: txt.slice(0, 8000) }] })
        }
      } catch (e) {
        sendResult(msg.id, {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        })
      }
      break
    }

    default:
      sendError(msg.id, -32601, `Method not found: ${msg.method}`)
  }
})

rl.on('close', () => process.exit(0))
