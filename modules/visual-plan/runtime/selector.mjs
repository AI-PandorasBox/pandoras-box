// ${MODULE_HOME}/selector.mjs
// _examplebrand_VISUAL_PLAN_V1 -- Task 003: Selector heuristics
//
// Per beat, selects one of 5 visual forms:
//   narrate-over-still        - single image, no motion
//   still+Ken-Burns-zoom      - slow zoom on detail
//   static-art-parallax       - 2-3 layer parallax composite
//   full-Veo-motion-burst     - 3-5s Veo video clip
//   transition-card           - black+gold rule+Greek key, <1.5s
//
// Rules are defined inline here (v1 heuristic).
// assistant can iterate rules in selector-rules.md; a future version will parse that file.

const VISUAL_FORMS = [
  'narrate-over-still',
  'still+Ken-Burns-zoom',
  'static-art-parallax',
  'full-Veo-motion-burst',
  'transition-card',
]

// Cost gate: max 1 Veo burst per ~90s of episode
const VEO_INTERVAL_S = 90

/**
 * Select the visual form for a single beat.
 *
 * @param {object} beat          - Beat from beat-segmenter.mjs
 * @param {string|null} prevForm - Visual form chosen for the preceding beat (adjacency constraint)
 * @param {object} contextStats  - { veoBurstsUsed: number, totalDuration: number, veoLastAt_s?: number }
 * @returns {string} visual_form
 */
export function selectVisualForm (beat, prevForm = null, contextStats = {}) {
  const { type, beat_index, position_in_episode, start_s } = beat
  const { veoBurstsUsed = 0, veoLastAt_s = -Infinity } = contextStats

  // ── Rule 1: Cover beat (beat_index === 0) is always narrate-over-still ──
  if (beat_index === 0) {
    beat.transition_card_type = undefined
    return 'narrate-over-still'
  }

  // ── Rule 2: Chapter / source boundary -> transition-card (mandatory) ──
  if (isBoundaryBeat(beat)) {
    beat.transition_card_type = type === 'direct-quote-source' ? 'source-quote' : 'chapter'
    return 'transition-card'
  }

  // ── Rule 3: Primary form selection by type ──
  let candidate = primaryFormForType(type, position_in_episode)

  // ── Rule 4: Adjacency constraint -- no two adjacent beats same form ──
  if (candidate === prevForm) {
    candidate = fallbackForm(type, candidate)
  }

  // ── Rule 5: Veo cost gate ──
  if (candidate === 'full-Veo-motion-burst') {
    const timeSinceLastVeo = start_s - veoLastAt_s
    if (timeSinceLastVeo < VEO_INTERVAL_S) {
      // Too soon -- downgrade to still+Ken-Burns-zoom for action, parallax for others
      candidate = type === 'action' ? 'still+Ken-Burns-zoom' : 'static-art-parallax'
    }
  }

  // ── Rule 6: Adjacent re-check after cost gate ──
  if (candidate === prevForm) {
    candidate = fallbackForm(type, candidate)
  }

  beat.transition_card_type = undefined
  return candidate
}

// ── Primary form by beat type ────────────────────────────────────────────────

function primaryFormForType (type, position) {
  switch (type) {
    case 'action':
      return 'full-Veo-motion-burst'

    case 'exposition':
    case 'catalogue':
    case 'direct-quote-source':
      return 'narrate-over-still'

    case 'reflection':
    case 'threshold':
      return 'still+Ken-Burns-zoom'

    case 'dialogue':
      // Dialogue at a threshold moment gets parallax for atmosphere; otherwise still
      return position === 'intro' || position === 'close' ? 'static-art-parallax' : 'narrate-over-still'

    default:
      return 'narrate-over-still'
  }
}

// ── Fallback form (avoids adjacent duplicate) ────────────────────────────────

function fallbackForm (type, blocked) {
  // Ordered preference per type, skip the blocked form
  const prefs = {
    'action':              ['still+Ken-Burns-zoom', 'static-art-parallax', 'narrate-over-still'],
    'exposition':          ['still+Ken-Burns-zoom', 'static-art-parallax', 'full-Veo-motion-burst'],
    'catalogue':           ['still+Ken-Burns-zoom', 'static-art-parallax', 'narrate-over-still'],
    'direct-quote-source': ['still+Ken-Burns-zoom', 'narrate-over-still', 'static-art-parallax'],
    'reflection':          ['static-art-parallax', 'narrate-over-still', 'full-Veo-motion-burst'],
    'threshold':           ['static-art-parallax', 'narrate-over-still', 'full-Veo-motion-burst'],
    'dialogue':            ['still+Ken-Burns-zoom', 'narrate-over-still', 'static-art-parallax'],
  }
  const list = prefs[type] || prefs['exposition']
  return list.find(f => f !== blocked) || 'narrate-over-still'
}

// ── Boundary detection ───────────────────────────────────────────────────────

function isBoundaryBeat (beat) {
  const text = beat.narration_text || ''

  // Source attribution in parentheses at start/end of beat text
  if (/^\s*\[Source:/i.test(text)) return true
  if (/\(Source:[^)]+\)\s*$/i.test(text)) return true

  // Chapter heading pattern (markdown-style, will be stripped before display)
  if (/^#+\s/.test(text)) return true

  // Explicit section marker words at the start of a beat
  if (/^(Chapter|Part|Section|Book|Canto)\s+\w/i.test(text)) return true

  return false
}

// ── Export for inspection ─────────────────────────────────────────────────────
export { primaryFormForType, isBoundaryBeat, VISUAL_FORMS }
