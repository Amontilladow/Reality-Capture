# Workforce Intelligence — Browser Extension (MVP)

A plain Manifest V3 browser extension (no bundler, no build step, no
store publishing) that reports the **domain** of the browser's active tab
to EngineeringOS's Workforce Intelligence API. It exists to close the one
real gap the desktop agent (`apps/agent`) leaves: the agent reports "the
active app is Chrome" for the entire time someone is in a browser, with
no visibility into *which* site — the piece DeskTime calls URL tracking.

**This pass deliberately does not build**: icons, a Chrome Web Store
listing, Firefox/Safari-specific manifest variants, or full-URL/path/query
tracking. It also does not do any keystroke logging, page-content
inspection, or history scraping — the only signal read from a tab is its
`URL.hostname`, nothing else about the page.

## What this captures, precisely

- **Only the hostname** of the active tab's URL (e.g. `github.com`), never
  the full URL, path, query string, or page title/content. `src/domain.js`
  is the one place this decision lives, and it's unit-tested.
- **Only while the tab is the active tab, in the focused browser window,
  and the OS itself is not idle.** Switching away, losing OS focus, or
  going idle all end the current segment.
- **Nothing for non-http(s) pages.** `chrome://` pages, `file://` paths,
  the extension's own popup, and malformed URLs all resolve to "not
  trackable" (`resolveTrackableDomain()` returns `null`) rather than being
  reported as some literal internal URL/path.

## How this reuses the existing backend unchanged

This package required **zero backend changes**. It reuses:

- `POST /auth/login` + `POST /workforce/devices` with `platform: 'web'` —
  already a valid `DEVICE_PLATFORMS` value since the original MVP schema,
  just never previously used by a real client.
- `POST /workforce/activities/ingest` — identical DTO the desktop agent
  uses. A closed domain segment maps `applicationNameRaw` to the domain
  itself (e.g. `"github.com"`), which means a visited domain flows through
  the *exact same* `application_registry` auto-registration and
  productive/neutral/unproductive classification pipeline the desktop
  agent's application names already use (see
  `apps/api/.../activities/activities.service.ts` and the "Application
  productivity (admin)" screen in `WorkforcePage`) — an admin classifies
  `github.com` the same way they'd classify `revit.exe`, no separate
  "domains" screen needed.
- The `'PRIVATE'` activity type — the popup's Private Time checkbox works
  exactly like the desktop agent's `private on`/`private off` (same
  server-side force-redaction in `ActivitiesService.insertOne()` applies
  here too, for free).

## Load it (development/testing only — no store listing)

1. Open `chrome://extensions` (or the Edge/Brave/other Chromium
   equivalent).
2. Enable **Developer mode** (top-right toggle).
3. **Load unpacked** → select this `apps/browser-extension/` directory.
4. Click the extension's icon in the toolbar to open the popup.
5. Enter the API server URL, your EngineeringOS email, and password, then
   **Enroll this browser**. This performs the same login + device
   enrollment the desktop agent's `enroll` command does, just via a form.
6. Browse normally. The service worker listens for tab/window/idle events
   (not a polling loop — see "Architecture" below) and flushes queued
   segments to the API roughly once a minute.

To turn on Private Time, open the popup and check the box; uncheck it to
resume normal tracking. There's no live push from the popup to the
background worker — the running service worker picks up the change on its
next tab/window/idle event, the same "polls a marker on its own next tick,
not instant" tradeoff the desktop agent's `private on/off` documents.

## Architecture

Unlike the desktop agent's 10-second polling loop, this extension is
**event-driven**: `chrome.tabs.onActivated`, `chrome.tabs.onUpdated`,
`chrome.windows.onFocusChanged`, and `chrome.idle.onStateChanged` each
trigger a state check, and `chrome.alarms` (not `setInterval`) drives the
once-a-minute flush — Manifest V3 service workers can be suspended between
events at any time, so a `setInterval` loop would not reliably survive the
way it does in the desktop agent's single long-lived Node process.

Because of that same suspension behavior, the currently-open segment is
persisted to `chrome.storage.local` after every state change
(`tracker.js`'s `toPersisted()`/`fromPersisted()`) rather than kept only in
the service worker's in-memory class instance, so a segment in progress
when the worker is suspended isn't silently lost when it wakes back up.

| File | What it does | Unit-tested? |
|---|---|---|
| `src/tracker.js` | Open/close segment decision logic (domain + activity type) | Yes (`tracker.test.js`) |
| `src/domain.js` | URL → trackable hostname resolution | Yes (`domain.test.js`) |
| `src/storage.js` | State/queue read-modify-write against an injectable storage area | Yes (`storage.test.js`) |
| `src/api-client.js` | fetch-based login/enroll/ingest + refresh-on-401 | No (network glue, same as the agent's own `api-client.ts`) |
| `src/background.js` | Wires `chrome.*` APIs to the modules above | No (no `chrome.*` under `node --test`, no real browser in this sandbox) |
| `src/popup.js` | Enrollment form + Private Time checkbox | No (DOM + `chrome.storage.local`) |

## How this was tested

Unit tests (`pnpm --filter browser-extension test`, Node's built-in test
runner, no browser involved) cover every pure decision this extension
makes: segment open/close logic, URL-to-domain resolution (including every
"don't track this" case), and the storage read-modify-write helpers — 19
tests, all passing.

**This has not been loaded into a real browser and exercised end-to-end.**
This sandbox has no browser UI to load an unpacked extension into, click
its popup, or watch `chrome.tabs`/`chrome.idle`/`chrome.alarms` fire for
real. `src/background.js` and `src/popup.js` — the two files that actually
call `chrome.*` APIs — are unverified beyond a manual read-through. If
something is wrong with this extension, it is much more likely to be in
those two files (a `chrome.*` API used incorrectly, a permission missing
from `manifest.json`) than in the tested logic they call. Loading this
unpacked into a real Chromium browser and confirming activity actually
reaches the Workforce dashboards is the next real step, the same as it was
for the desktop agent.

## Known MVP limitations (deliberate, not oversights)

- **`<all_urls>` host permission.** Broader than strictly necessary (a
  fixed, known API origin would need only that one host), but the API
  server URL is user-configurable at enroll time (same as the desktop
  agent's `AGENT_SERVER_URL`), so the exact origin isn't known at build
  time. Scoping this down once a company's API origin is fixed is a
  reasonable V1 hardening item, not something this pass needs.
- **No icons / no store listing.** Chrome shows its default puzzle-piece
  icon. This is a `chrome://extensions` → "Load unpacked" tool for
  testing, not a published extension.
- **Plaintext tokens in `chrome.storage.local`.** Same tradeoff the
  desktop agent's `config.json` makes (see its README), for the same
  reason — per-device token auth is an already-documented V1 hardening
  item, not an MVP requirement.
- **One browser window/profile at a time, informally.** Nothing stops
  enrolling the same account in multiple browser profiles as separate
  devices (each gets its own `deviceId`), which is fine — it's just not a
  scenario this MVP specifically designed for or tested against.
- **No offline queue cap enforcement beyond the 500-item flush batch.**
  Unlike the desktop agent, this doesn't have a disk-space concern (it's a
  handful of small JSON objects in `chrome.storage.local`), but there's
  also no explicit cap on how large the queue can grow if the API is
  unreachable for a very long time.
