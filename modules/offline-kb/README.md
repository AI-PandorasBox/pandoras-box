# offline-kb

**Status:** Optional
**Depends on:** personal-ai
**Storage:** **OFFLINE.** Downloads are large but read locally -- no per-query
charge for stable reference content.

## What It Does

the Offline Knowledge Library is your Personal Assistant's offline knowledge base. It indexes a
curated library of content that does not change often -- Wikipedia, Stack
Overflow, iFixit, Project Gutenberg, Khan Academy -- so the assistant can
answer reference questions without spending money on web search APIs.

The assistant **prefers the Offline Knowledge Library** for stable reference content (technical
docs, history, biographies, repair guides, programming questions) and only
falls back to live web search (Brave) for current events.

This significantly reduces Brave Search quota burn on a typical user --
Wikipedia + Stack Overflow alone cover most "what is X" / "how do I do Y"
questions a personal assistant gets asked.

## Sources

You pick which to download during install. All are free, all are offline ZIM
files (a Wikipedia-derived format read by Kiwix).

| Source | Approx size | Notes |
|---|---|---|
| Wikipedia (English, full) | ~95 GB | The big one. Recommended. |
| Stack Overflow | ~30 GB | Programming Q&A. Highly recommended. |
| iFixit (repair guides) | ~3 GB | Small, useful. |
| Project Gutenberg | ~80 GB | Public-domain literature. |
| Khan Academy | ~12 GB | Educational explainers. |

Total if you take all five: ~220 GB. Most users start with Wikipedia + Stack
Overflow + iFixit (~128 GB).

## Requirements

- 60 GB free disk minimum (the installer pre-checks). 200+ GB if you want
  all five sources.
- Docker -- Kiwix runs in a container. The installer will offer to install
  Docker via Homebrew Cask if it's missing. (Docker Desktop's first-run
  setup must be done manually -- Apple's licence model.)
- Stable broadband for the first download (95 GB at home broadband can take
  hours).

## Monthly Cost

Free. ZIM files are free downloads from
https://download.kiwix.org/zim/. No subscription, no per-query charge, no
ongoing storage cost beyond what your local disk gives you.

You may *save* significant Brave Search quota by having the Offline Knowledge Library. A typical
personal assistant burns most of its Brave quota on "stable reference"
queries -- the Offline Knowledge Library absorbs those.

## How the assistant decides what to use

Your assistant has both `search_knowledge` (the Offline Knowledge Library) and `brave_search`
(Brave). It picks based on the query:

- "What's the half-life of carbon-14?" -> the Offline Knowledge Library (stable reference)
- "Latest on the GBP/USD rate" -> Brave (current event)
- "How do I replace a MacBook battery?" -> the Offline Knowledge Library (iFixit)
- "What did the FOMC say today?" -> Brave (current event)

You don't need to tell it which to use. The selection is part of the routing
prompt.

## Configuration

`/opt/pandoras-box/offline-kb/scope.json` -- which sources are enabled. To add a
source after install, edit this file then run:

```bash
sudo bash /opt/pandoras-box/scripts/offline-kb-zim-add.sh <source-name>
```

## Uninstall

```bash
launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.offline-kb-kiwix.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.offline-kb-kiwix.plist
docker stop pbox-kiwix && docker rm pbox-kiwix
sudo rm -rf /opt/pandoras-box/offline-kb
```

This frees the 60+ GB the ZIM files were using.
