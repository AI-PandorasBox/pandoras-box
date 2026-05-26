# deck-builder

Build PowerPoint decks (`.pptx`) from a simple JSON spec — locally, with
`python-pptx`. No cloud, no API. Your assistant (or you) writes the spec; this
renders the slides with titles, bullets, body text, speaker notes, and a brand
accent colour.

## Install

```bash
bash modules/deck-builder/install.sh    # installs python-pptx + the `pbox-deck` command
```

## Use

```bash
pbox-deck --spec deck.json --out deck.pptx [--brand pandoras-box]
```

Spec:

```json
{
  "title": "Quarterly review",
  "subtitle": "Q2 2026",
  "author": "Your Company",
  "slides": [
    {"title": "Highlights", "bullets": ["Revenue up 12%", "Two new clients"], "notes": "talk to the trend"},
    {"title": "Plan", "text": "Short body paragraph.", "notes": "context for you"}
  ]
}
```

Brand accents live in `runtime/brand-profiles.json` (`accent_rgb`); add your own.

## Roadmap (v1.1)

- More layouts (two-column, image, section dividers), chart helpers, logo on the master.
