// ${MODULE_HOME}/dispatcher.mjs
// _examplebrand_VISUAL_PLAN_V1 -- Task 004: Dispatcher to existing generators
//
// For each beat in the plan, calls the appropriate generator:
//   narrate-over-still        -> generateImage (examplebrand_v1 preset, prompt from asset_spec)
//   still+Ken-Burns-zoom      -> generateImage + returns ffmpeg_transform spec
//   static-art-parallax       -> generateImage x3 layers + returns ffmpeg_transform spec
//   full-Veo-motion-burst     -> veoGenerate (3-5s)
//   transition-card           -> SVG spec render (rasterize stub)
//
// adapters: { generateImage, veoGenerate } -- passed in from personalai.mjs context.
// Neither is called in DRY_RUN mode.
//
// NOTE: veo_generate exists in personalai.mjs as `veoGenerate`. Confirmed at task build time.
// NOTE: generate_image returns { imageData: base64, mimeType }; this module saves to /tmp.

import { writeFileSync, mkdirSync } from 'node:fs'
import { join }                     from 'node:path'

const examplebrand_STYLE_TAG = 'examplebrand_v1'
const OUTPUT_BASE        = '${PBOX_SHARED}/projects/examplebrand/drops/video' // _examplebrand_STORAGE_C_V1

/**
 * Dispatch a single beat to the appropriate generator.
 *
 * @param {object} beatPlan   - Entry from the plan array (includes asset_spec)
 * @param {string} episodeId  - e.g. 's01e03'
 * @param {object} adapters   - { generateImage, veoGenerate } from personalai.mjs
 * @returns {object} { beat_index, image_path?, video_path?, ffmpeg_spec?, svg_spec?, error? }
 */
export async function dispatchBeat (beatPlan, episodeId, adapters = {}) {
  const { beat_index, visual_form, asset_spec } = beatPlan
  const outputDir = join(OUTPUT_BASE, episodeId)

  try {
    mkdirSync(outputDir, { recursive: true })
  } catch (e) {
    return { beat_index, error: 'Could not create output dir: ' + e.message }
  }

  switch (visual_form) {
    case 'narrate-over-still':
      return await dispatchStill(beat_index, asset_spec, outputDir, adapters)

    case 'still+Ken-Burns-zoom':
      return await dispatchKenBurns(beat_index, asset_spec, outputDir, adapters)

    case 'static-art-parallax':
      return await dispatchParallax(beat_index, asset_spec, outputDir, adapters)

    case 'full-Veo-motion-burst':
      return await dispatchVeo(beat_index, asset_spec, outputDir, adapters)

    case 'transition-card':
      return dispatchTransitionCard(beat_index, asset_spec, outputDir)

    default:
      return { beat_index, error: `Unknown visual_form: ${visual_form}` }
  }
}

// ── narrate-over-still ───────────────────────────────────────────────────────

async function dispatchStill (beatIndex, spec, outputDir, adapters) {
  if (!adapters.generateImage) return { beat_index: beatIndex, error: 'generateImage adapter not provided' }

  const result = await adapters.generateImage(spec.image_prompt, 'fast')
  if (result.error) return { beat_index: beatIndex, error: result.error }

  const imgPath = join(outputDir, `beat-${String(beatIndex).padStart(3, '0')}-still.png`)
  writeFileSync(imgPath, Buffer.from(result.imageData, 'base64'))

  return { beat_index: beatIndex, image_path: imgPath }
}

// ── still+Ken-Burns-zoom ─────────────────────────────────────────────────────

async function dispatchKenBurns (beatIndex, spec, outputDir, adapters) {
  if (!adapters.generateImage) return { beat_index: beatIndex, error: 'generateImage adapter not provided' }

  const result = await adapters.generateImage(spec.image_prompt, 'fast')
  if (result.error) return { beat_index: beatIndex, error: result.error }

  const imgPath = join(outputDir, `beat-${String(beatIndex).padStart(3, '0')}-kb-source.png`)
  writeFileSync(imgPath, Buffer.from(result.imageData, 'base64'))

  // Return the source image + ffmpeg filter spec for assembly stage
  return {
    beat_index:  beatIndex,
    image_path:  imgPath,
    ffmpeg_spec: buildKenBurnsFilter(imgPath, spec.ffmpeg_transform),
  }
}

// ── static-art-parallax ──────────────────────────────────────────────────────

async function dispatchParallax (beatIndex, spec, outputDir, adapters) {
  if (!adapters.generateImage) return { beat_index: beatIndex, error: 'generateImage adapter not provided' }

  const layers  = spec.layers || []
  const layerPaths = []

  for (const layer of layers) {
    const result = await adapters.generateImage(layer.image_prompt, 'fast')
    if (result.error) return { beat_index: beatIndex, error: `Layer ${layer.depth}: ${result.error}` }
    const layerPath = join(outputDir, `beat-${String(beatIndex).padStart(3, '0')}-parallax-${layer.depth}.png`)
    writeFileSync(layerPath, Buffer.from(result.imageData, 'base64'))
    layerPaths.push({ depth: layer.depth, path: layerPath })
  }

  return {
    beat_index:   beatIndex,
    layer_paths:  layerPaths,
    ffmpeg_spec:  buildParallaxFilter(layerPaths, spec.ffmpeg_transform),
  }
}

// ── full-Veo-motion-burst ────────────────────────────────────────────────────

async function dispatchVeo (beatIndex, spec, outputDir, adapters) {
  if (!adapters.veoGenerate) {
    // veoGenerate confirmed present in personalai.mjs but log if adapter not passed
    return { beat_index: beatIndex, error: 'veoGenerate adapter not provided (out-of-scope dep: ensure personalai passes adapters.veoGenerate)' }
  }

  const result = await adapters.veoGenerate(spec.video_prompt)
  if (result.error) return { beat_index: beatIndex, error: result.error }

  // Veo may return async operation or inline video
  if (result.operationName) {
    return {
      beat_index:     beatIndex,
      veo_operation:  result.operationName,
      status:         'pending',
      note:           'Veo job started. Poll veo_generate or wait ~2min for videoPath.',
    }
  }

  // Inline path (veoGenerate saved to /tmp/veo-*.mp4)
  const finalPath = join(outputDir, `beat-${String(beatIndex).padStart(3, '0')}-veo.mp4`)
  const srcPath   = result.videoPath || result.videoUrl
  if (result.videoPath) {
    // Move from /tmp to episode-specific dir
    const { renameSync } = await import('node:fs')
    try { renameSync(result.videoPath, finalPath) } catch { /* file may already be at finalPath */ }
    return { beat_index: beatIndex, video_path: finalPath }
  }

  return { beat_index: beatIndex, video_url: result.videoUrl, note: 'Remote URL -- download before assembly' }
}

// ── transition-card ──────────────────────────────────────────────────────────

function dispatchTransitionCard (beatIndex, spec, outputDir) {
  const svg     = spec.svg_spec || {}
  const svgSpec = {
    background: svg.background || '#0a0a0a',
    rule_color: svg.rule_color || '#c9a84c',
    motif:      svg.motif      || 'greek_key',
    text:       svg.text       || '',
    font:       svg.font       || 'Cormorant Garamond',
    duration_s: svg.duration_s || 1.0,
    width:      1920,
    height:     1080,
  }

  // Generate the SVG source
  const svgSource = renderTransitionCardSVG(svgSpec)
  const svgPath   = join(outputDir, `beat-${String(beatIndex).padStart(3, '0')}-card.svg`)
  writeFileSync(svgPath, svgSource)

  // Rasterize spec (assembly stage calls: ffmpeg -i card.svg -vframes 1 card.png)
  const pngPath = join(outputDir, `beat-${String(beatIndex).padStart(3, '0')}-card.png`)

  return {
    beat_index: beatIndex,
    svg_path:   svgPath,
    image_path: pngPath,   // target path after rasterize
    rasterize_cmd: [
      'ffmpeg', '-y',
      '-i', svgPath,
      '-vframes', '1',
      pngPath,
    ],
    duration_s: svgSpec.duration_s,
  }
}

// ── SVG renderer ─────────────────────────────────────────────────────────────

function renderTransitionCardSVG (spec) {
  const { width, height, background, rule_color, text, font } = spec
  const centerY    = height / 2
  const ruleY1     = centerY - 60
  const ruleY2     = centerY + 60
  const textY      = centerY + 8
  const fontSize   = text.length > 60 ? 28 : text.length > 30 ? 36 : 44
  const escapedText = escapeXml(text)

  // Greek key motif as a repeated SVG pattern (simplified corner version)
  const greekKey = greekKeyPattern(rule_color)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${greekKey.defs}
  </defs>
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="${background}"/>
  <!-- Greek key border -->
  <rect x="32" y="32" width="${width - 64}" height="${height - 64}" fill="none" stroke="${rule_color}" stroke-width="1.5" stroke-dasharray="none"/>
  <!-- Greek key pattern on top and bottom border -->
  <rect x="32" y="32" width="${width - 64}" height="24" fill="url(#gk-pattern)" opacity="0.6"/>
  <rect x="32" y="${height - 56}" width="${width - 64}" height="24" fill="url(#gk-pattern)" opacity="0.6"/>
  <!-- Top rule line -->
  <line x1="120" y1="${ruleY1}" x2="${width - 120}" y2="${ruleY1}" stroke="${rule_color}" stroke-width="1.5"/>
  <!-- Bottom rule line -->
  <line x1="120" y1="${ruleY2}" x2="${width - 120}" y2="${ruleY2}" stroke="${rule_color}" stroke-width="1.5"/>
  <!-- Gold dot accents -->
  <circle cx="120" cy="${ruleY1}" r="3" fill="${rule_color}"/>
  <circle cx="${width - 120}" cy="${ruleY1}" r="3" fill="${rule_color}"/>
  <circle cx="120" cy="${ruleY2}" r="3" fill="${rule_color}"/>
  <circle cx="${width - 120}" cy="${ruleY2}" r="3" fill="${rule_color}"/>
  <!-- Card text -->
  <text
    x="${width / 2}"
    y="${textY}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="${font}, 'Times New Roman', serif"
    font-size="${fontSize}"
    fill="#e8d9b0"
    letter-spacing="3"
  >${escapedText}</text>
</svg>`
}

function greekKeyPattern (color) {
  // Minimal 24x24 greek key tile
  const c = escapeXml(color)
  return {
    defs: `<pattern id="gk-pattern" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect width="24" height="24" fill="none"/>
      <polyline points="2,2 22,2 22,14 14,14 14,6 6,6 6,22 2,22" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="miter"/>
    </pattern>`,
  }
}

function escapeXml (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ── ffmpeg filter specs ───────────────────────────────────────────────────────

function buildKenBurnsFilter (imgPath, transform = {}) {
  const zFrom = transform.zoom_from  || 1.0
  const zTo   = transform.zoom_to    || 1.15
  const dur   = transform.duration_s || 5.0
  const fps   = 25
  const nFrames = Math.round(dur * fps)

  // ffmpeg zoompan filter for Ken-Burns zoom in
  return {
    type:        'ken_burns_zoom',
    input_path:  imgPath,
    filter:      `zoompan=z='if(lte(zoom,${zFrom}),${zFrom},zoom+${((zTo - zFrom) / nFrames).toFixed(6)})':d=${nFrames}:s=1920x1080:fps=${fps}`,
    duration_s:  dur,
  }
}

function buildParallaxFilter (layerPaths, transform = {}) {
  const dur    = transform.duration_s || 5.0
  const shifts = transform.shift_px   || { background: 0, midground: 8, foreground: 16 }

  // ffmpeg overlay chain spec (assembly stage builds the actual command)
  return {
    type:       'parallax_composite',
    layers:     layerPaths.map(l => ({
      path:    l.path,
      depth:   l.depth,
      shift_x: shifts[l.depth] ?? 0,
    })),
    duration_s: dur,
    width:      1920,
    height:     1080,
  }
}
