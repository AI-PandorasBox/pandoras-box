# personal-sensor

**Status:** Optional
**Depends on:** personal-ai
**Replaces:** the previous `watch-companion` module (now bundled into the Personal Sensor Layer)

## What It Does

the Personal Sensor Layer is your Personal Assistant's ambient sensor layer plus the smartwatch
companion that surfaces what it senses.

The two are bundled into one module because they make sense together: the Personal Sensor Layer
without a watch still works (signals surface in the browser app), but the
watch is where most users actually notice the signals during their day.

### Sensor layer (the Personal Sensor Layer proper)

A passive daemon (`personal-sensor-signals`, runs hourly under the same service-account user as the Personal Assistant)
that watches:

- Calendar proximity ("meeting in 20 min, leave for X")
- Unread email count + urgency classification
- Named places + geofencing ("you've arrived at home")
- Step count and heart rate (via Google Fit / Apple Health on the phone)
- Free-time gaps in your calendar
- Gone-quiet contacts (graph-driven: people you used to interact with
  regularly but have not contacted in 14+ days)

the Personal Sensor Layer writes structured signals to a state file that your Personal Assistant
reads. **No LLM calls happen at the sensor layer** -- the assistant decides
when to act on a signal (whether to push a notification, queue an action, or
ignore). LLM cost only applies when the assistant actually does something.

### Watch companion

A smartwatch app for either:

- Wear OS (Pixel Watch 4, Galaxy Watch 6+, etc.)
- Apple Watch (Series 6+, watchOS 10+)

Watch surfaces:
- Voice input ("hey, what's on today?")
- Notification cards (pending email drafts, urgent items, meeting reminders)
- Active Mode pings (proactive surfacing during the configured window)
- Quick reply / approve / reject for drafts

The watch talks to a phone-side companion app (Tailscale required), which
talks to your Pandoras Box.

## Active Mode

the Personal Sensor Layer supports an "Active Mode" -- a configurable time window when proactive
surfacing is allowed. Outside the window, the Personal Sensor Layer still senses but stays
silent. Defaults: 08:00-20:00 weekdays, weekends silent. Configurable from
the Personal Assistant or in `/opt/pandoras-box/personal-sensor/active-mode.json`.

## Requirements

- `personal-ai` module installed (Personal Assistant is the consumer of
  the Personal Sensor Layer signals)
- Phone with Tailscale running (for the watch + phone-app path)
- Optional but useful:
  - Pixel Watch / Galaxy Watch (Wear OS 4+) OR Apple Watch (Series 6+,
    watchOS 10+)
  - Google Fit (Android) or Apple Health permission (iOS) for fitness signals
- Addresses you want geofenced (home, office, regular client sites) --
  collected during install

## Monthly Cost

Free. The watch app is sideloaded (Wear OS) or via the iOS companion app --
no app store fee. No subscription.

## Configuration

Edit during install or later:

- `/opt/pandoras-box/personal-sensor/active-mode.json` -- start/end hour, weekend
  toggle, plan refresh interval
- `/opt/pandoras-box/personal-sensor/places.json` -- named places (lat/lng/radius)
- `/opt/pandoras-box/personal-sensor/.env` -- daemon config

## Phone-side install

After this module is installed, see `/opt/pandoras-box/docs/watch-setup.md`
for phone-app sideload instructions (Wear OS) or App Store link (Apple
Watch). The doc is also linked from the dashboard.

## Uninstall

```bash
launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.personal-sensor-signals.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.personal-sensor-signals.plist
sudo rm -rf /opt/pandoras-box/personal-sensor
```

This stops the sensor layer. The phone + watch apps keep working but stop
receiving signals; uninstall them from your phone separately.
