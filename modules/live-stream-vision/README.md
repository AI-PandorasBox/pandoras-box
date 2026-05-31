# Live Stream Vision

Real-time visual awareness for the personal AI. Share a screen or point a camera,
and the assistant can see the live stream and reason over what it shows.

## What it does

- **Screen share** - stream a desktop/window to the assistant for live support.
- **Camera vision** - stream a phone or desktop camera; the assistant sees what you see.
- **Frame-by-frame analysis** - frames are sampled into a ring buffer, sent to a
  vision model, and salient observations are written to the assistant's memory so
  it can refer back to them later in the conversation.

## How it works

```
browser (getDisplayMedia / getUserMedia)
      -> frame sampler (worker)  -> ring buffer
      -> vision client (Gemini)  -> observations
      -> memory writer           -> session memory
```

A **session controller** opens and closes streams. Vision only runs while a
session is explicitly open - there is no always-on capture. The module is
session-scoped and operator-gated.

## Requirements

- `core` and `personal-ai` modules installed.
- A Google AI API key (`GEMINI_API_KEY`) for the vision model. Without it the
  module installs but stays inert.

## Enabling

This is an **optional** module. It ships disabled and only activates when turned
on for an agent in the activation matrix, and only when `GEMINI_API_KEY` is set.

## Privacy

Frames are sent to the configured vision provider (Google AI by default) only
while a session is open. Nothing is captured or transmitted outside an open
session. See the project security model for the full data-flow.
