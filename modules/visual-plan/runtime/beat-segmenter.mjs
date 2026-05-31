// ${MODULE_HOME}/beat-segmenter.mjs
// _examplebrand_VISUAL_PLAN_V1 -- Task 002: Beat segmentation
//
// Groups narration text into beats of 3-8 seconds.
// Each beat carries: duration_s, position_in_episode, type.
//
// Beat types (heuristic keyword classification):
//   action          -- verbs of motion/conflict (attacked, fled, struck, seized, fell)
//   exposition      -- descriptive present/past tense, geography, background
//   reflection      -- abstract nouns, internal states (wisdom, fate, glory, hubris)
//   dialogue        -- contains quoted speech or direct address markers
//   threshold       -- liminal events (arrived, crossed, descended, entered, began, ended)
//   catalogue       -- lists (names, places, ships) -- semicolons / commas + proper nouns
//   direct-quote-source -- "[Source:" or parenthetical source attribution

const WPM_DEFAULT     = 150
const BEAT_MIN_S      = 3.0
const BEAT_MAX_S      = 8.0
const CHARS_PER_WORD  = 5.2  // average characters per word for rough estimation

// Chapter / source boundary markers that trigger a transition-card beat before them.
const CHAPTER_MARKERS   = /^#+\s|^---+$|^===+$/m
const SOURCE_MARKER_RE  = /\[Source:/i

// Regex patterns for beat type classification
const ACTION_RE      = /\b(attack|struck|struck|fell|seized|fled|fought|killed|destroyed|charged|hurled|defeated|conquered|slaughtered|routed|besieged)\w*/i
const THRESHOLD_RE   = /\b(arrived|crossed|descended|entered|departed|began|ended|returned|reached|left|sailed|landed)\w*/i
const DIALOGUE_RE    = /["'"“”‘’]|he said|she said|they said|replied|answered|proclaimed|declared|cried|shouted/i
const REFLECTION_RE  = /\b(wisdom|fate|glory|hubris|honour|honor|pride|destiny|divine|sacred|prophecy|oracle|virtue|arete|moira|oversight)\w*/i
const CATALOGUE_RE   = /[;,]\s+[A-Z][a-z]|(?:[A-Z][a-z]+,?\s+){3}/
const SOURCE_QUOTE_RE = /\[Source:|^\(.*\)$/m

/**
 * Segment narration text into beats of 3-8s.
 *
 * @param {string} text - Full narration text.
 * @param {Array|null} wordTimings - Per-word timing [{word, start_s, end_s}] from audio_narrate.
 * @param {number|null} targetDurationS - Total episode target duration (used only when wordTimings absent).
 * @returns {Array} beats - Array of beat objects.
 */
export function segmentBeats (text, wordTimings = null, targetDurationS = null) {
  if (!text || typeof text !== 'string') return []

  const cleanedText = text.trim()

  if (wordTimings && Array.isArray(wordTimings) && wordTimings.length > 0) {
    return segmentFromTimings(cleanedText, wordTimings)
  }

  return segmentByEstimate(cleanedText, targetDurationS)
}

// ── Timing-driven segmentation ───────────────────────────────────────────────

function segmentFromTimings (text, wordTimings) {
  const beats = []
  let beatStart  = wordTimings[0].start_s
  let beatWords  = []
  let beatIndex  = 0

  for (let i = 0; i < wordTimings.length; i++) {
    const wt = wordTimings[i]
    beatWords.push(wt.word)
    const beatDuration = wt.end_s - beatStart

    const atBoundary = isNaturalBoundary(wt.word)
    const overMin    = beatDuration >= BEAT_MIN_S
    const overMax    = beatDuration >= BEAT_MAX_S
    const isLast     = i === wordTimings.length - 1

    if ((overMin && atBoundary) || overMax || isLast) {
      const narrationText = beatWords.join(' ')
      beats.push(makeBeat(beatIndex, beatStart, wt.end_s, narrationText))
      beatIndex++
      beatStart = (wordTimings[i + 1]?.start_s) ?? wt.end_s
      beatWords = []
    }
  }

  return annotatePositions(beats)
}

// ── Estimate-driven segmentation (150 wpm) ───────────────────────────────────

function segmentByEstimate (text, targetDurationS) {
  // Split on sentence boundaries, then group into target beat durations.
  const sentences = splitSentences(text)
  const wpm = WPM_DEFAULT

  // Calculate per-sentence duration from word count
  const sentencesWithDur = sentences.map(s => {
    const wordCount = countWords(s)
    const dur = (wordCount / wpm) * 60
    return { text: s, dur }
  })

  // If targetDurationS given, scale proportionally
  if (targetDurationS) {
    const rawTotal = sentencesWithDur.reduce((s, x) => s + x.dur, 0)
    const scale    = targetDurationS / rawTotal
    sentencesWithDur.forEach(x => { x.dur *= scale })
  }

  // Group sentences into beats [BEAT_MIN_S .. BEAT_MAX_S]
  const beats     = []
  let beatIndex   = 0
  let currentTime = 0
  let beatTexts   = []
  let beatStart   = 0
  let beatDur     = 0

  for (const s of sentencesWithDur) {
    const wouldExceedMax = beatDur + s.dur > BEAT_MAX_S && beatDur >= BEAT_MIN_S

    if (wouldExceedMax) {
      // Flush current beat
      beats.push(makeBeat(beatIndex, beatStart, beatStart + beatDur, beatTexts.join(' ')))
      beatIndex++
      beatStart  = currentTime
      beatTexts  = [s.text]
      beatDur    = s.dur
    } else {
      beatTexts.push(s.text)
      beatDur += s.dur
    }

    currentTime += s.dur

    // Force flush at sentence boundary if over min
    const isNatural = /[.!?]\s*$/.test(s.text)
    if (isNatural && beatDur >= BEAT_MIN_S && beatDur <= BEAT_MAX_S) {
      beats.push(makeBeat(beatIndex, beatStart, beatStart + beatDur, beatTexts.join(' ')))
      beatIndex++
      beatStart = currentTime
      beatTexts = []
      beatDur   = 0
    }
  }

  // Flush remainder
  if (beatTexts.length > 0) {
    const endTime = beatStart + Math.max(beatDur, BEAT_MIN_S)
    beats.push(makeBeat(beatIndex, beatStart, endTime, beatTexts.join(' ')))
  }

  return annotatePositions(beats)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBeat (beatIndex, startS, endS, narrationText) {
  const duration_s = Math.round((endS - startS) * 100) / 100
  return {
    beat_index:     beatIndex,
    start_s:        Math.round(startS * 100) / 100,
    end_s:          Math.round(endS   * 100) / 100,
    duration_s:     Math.max(duration_s, BEAT_MIN_S),
    narration_text: narrationText.trim(),
    position_in_episode: null, // filled by annotatePositions
    type:           classifyBeatType(narrationText),
  }
}

function annotatePositions (beats) {
  if (beats.length === 0) return beats
  const total = beats[beats.length - 1].end_s
  return beats.map(b => {
    const mid  = (b.start_s + b.end_s) / 2
    const pct  = total > 0 ? mid / total : 0
    b.position_in_episode = pct < 0.10 ? 'intro' : pct > 0.85 ? 'close' : 'body'
    return b
  })
}

function classifyBeatType (text) {
  if (SOURCE_QUOTE_RE.test(text))  return 'direct-quote-source'
  if (CATALOGUE_RE.test(text))     return 'catalogue'
  if (DIALOGUE_RE.test(text))      return 'dialogue'
  if (ACTION_RE.test(text))        return 'action'
  if (THRESHOLD_RE.test(text))     return 'threshold'
  if (REFLECTION_RE.test(text))    return 'reflection'
  return 'exposition'
}

function isNaturalBoundary (word) {
  return /[.!?,;]$/.test(word)
}

function splitSentences (text) {
  // Split on sentence-ending punctuation, keeping the punctuation attached.
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function countWords (text) {
  return text.trim().split(/\s+/).length
}

// ── Unit-testable export for beat type classification ────────────────────────
export { classifyBeatType }
