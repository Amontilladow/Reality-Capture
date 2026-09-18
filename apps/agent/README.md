# Workforce Intelligence — Desktop Agent (MVP)

A plain Node.js background process (not Electron) that reports active
application / idle time to EngineeringOS's Workforce Intelligence API, and
optionally captures periodic screenshots and/or the active window's title
bar text if the company has explicitly enabled each of those separately.

**This pass deliberately does not build**: a tray icon, auto-launch,
or a signed installer. Get the core loop proven against a real machine
first (this document); packaging polish is a separate, explicit fast-
follow, not a blocker to it. It also does not do any keystroke logging or
global input hooks — idle detection is the OS idle-time API only
(`desktop-idle`, wrapping `GetLastInputInfo` on Windows and the platform
equivalent elsewhere), never a keylogger.

**On window titles specifically**: this agent captures the active
window's title bar text (`native.ts`'s `getWindowTitle()`) — the exact
same string already visible at the top of the window on the employee's
own screen — on every sample, same as it captures the app name. That is
meaningfully more revealing than an app name alone: a title can carry a
document's filename, an email subject line, a browser tab's page title.
The agent always *sends* whatever title it observes; whether the server
actually *stores* it is gated entirely server-side by one company-wide
switch (`workforce_privacy_settings.window_title_enabled`, **off by
default**, alongside `screenshot_enabled`), enforced regardless of what
this or any other client sends — see `ActivitiesService.insertOne()`. It
is never captured (not even locally) while Private Time is on.

## What this agent does

1. **Enrollment** (`pnpm --filter agent enroll`): logs in with a real user's
   email/password (the existing `/auth/login` flow — there is no separate
   device-token auth yet), self-enrolls a device under that user via
   `POST /workforce/devices`, and saves the session + device ID to
   `~/.reality-capture-agent/config.json` (`chmod 600`).
2. **Activity loop** (`pnpm --filter agent start`): samples the active
   application (`active-win`), its window title, and system idle time
   (`desktop-idle`) every 10 seconds. Whenever the app or active/idle
   state changes, it closes the just-ended segment into a local
   append-only queue file (`~/.reality-capture-agent/queue.jsonl`) and
   starts a new one — a title change alone does not close a segment, it
   just updates the title recorded against the currently-open one. Every
   60 seconds it flushes up to 500 queued segments to
   `POST /workforce/activities/ingest`, removing them from the queue only
   on a confirmed successful response — a network outage just means the
   same segments retry on the next cycle, nothing is lost.
3. **Screenshot loop**: every `screenshotIntervalMinutes` (default 90), it
   asks the server for permission (`POST /workforce/screenshots/upload-url`).
   If the company has screenshots disabled, the server returns 403 and the
   agent logs a quiet skip — this is the expected, normal state for most
   companies most of the time, not an error condition. If approved, it
   captures the screen (`screenshot-desktop`), uploads it to the presigned
   URL, and records it via `POST /workforce/screenshots`.

## Prerequisites

- Node.js >= 22.13 (matches the rest of this monorepo)
- pnpm >= 9
- A real Windows or macOS machine with a display. `active-win` and
  `screenshot-desktop` need one; this cannot be meaningfully run headless
  or in a Linux container without a display.
- A test user account on the target EngineeringOS company, with the
  `workforce` subscription feature flag enabled for that company.

## Setup

From the repo root:

```bash
pnpm install
```

## Enroll

Recommended (scripted, avoids typing a password into an interactive
prompt that a shell history might capture):

```bash
AGENT_SERVER_URL="https://engineeringos-api.onrender.com/api/v1" \
AGENT_EMAIL="you@yourcompany.com" \
AGENT_PASSWORD="..." \
pnpm --filter agent enroll
```

Or run `pnpm --filter agent enroll` with no env vars set and answer the
interactive prompts (server URL, email, password — **not masked**; this is
an MVP local test tool, not a hardened credential entry flow).

This should print something like:

```
Enrolled device 3f2a1b9c-... (windows, DESKTOP-ABC123) for you@yourcompany.com.
Config saved. Run "pnpm --filter agent start" to begin tracking.
```

Confirm the device shows up in the company's `devices` table (or via the
Workforce Intelligence device list in the app) before moving on.

## Run

```bash
pnpm --filter agent start
```

This keeps the process alive in the foreground and logs each flush/
screenshot cycle to stdout. For this pass, "running the agent" means:

- Leaving this terminal open, **or**
- Running it under `pm2` (`pm2 start "pnpm --filter agent start" --name workforce-agent`)
  or as a Windows Task Scheduler entry / macOS `launchd` job pointed at the
  same command — set up manually by whoever is testing it. None of that
  automation is built or scripted by this package yet.

Stop it with Ctrl+C (or `SIGTERM`) — it flushes whatever's queued,
including the segment that was still open, before exiting.

## Private Time

DeskTime's own term for it, and the same idea: pause detailed tracking
without stopping the agent entirely.

```bash
pnpm --filter agent private:on   # or: tsx src/index.ts private on
pnpm --filter agent private:off  # or: tsx src/index.ts private off
```

While Private Time is on, the running agent never reads the real active
window at all -- every segment is recorded as activity type `PRIVATE` with
`applicationNameRaw` fixed to the literal string `"Private"`. It still
counts as tracked/active time (the productivity dashboards show a
"Private time" total), just with no app, window, or domain details, and
screenshots keep running on their own schedule regardless (turn off
screenshot capture separately, company-wide, via the Privacy settings
admin screen if that's the concern). The API also force-redacts these
fields server-side regardless of what any client sends, so the guarantee
holds even against a modified or buggy agent.

There is no tray icon or IPC channel in this plain-Node MVP, so `private
on`/`private off` are short-lived one-off commands (same shape as
`enroll`) that flip a marker file the long-running `start` process polls
on its own next 10-second sample tick -- expect up to ~10s of lag, not
instant effect.

## Configuration

Edit `~/.reality-capture-agent/config.json` directly (there is no
server-pushed config for MVP):

| Key | Default | Meaning |
|---|---|---|
| `screenshotIntervalMinutes` | 90 | How often to attempt a screenshot cycle |
| `idleThresholdSeconds` | 120 | Idle seconds before a segment is classified `IDLE` instead of `ACTIVE` |

## Known MVP limitations (deliberate, not oversights)

- **Plaintext token storage.** `config.json` holds a raw access/refresh
  token pair, `chmod 600`'d to the owning OS user. Per-device token auth
  (so a compromised agent config doesn't equal a compromised user account)
  is an explicit, already-documented V1 hardening item in
  `docs/workforce-intelligence-architecture.md`, not something MVP needs.
  Real OS-keychain integration was considered and skipped here too — it's
  a genuine per-OS scope expansion (different native APIs on Windows/
  macOS/Linux), not a trivial add.
- **No packaging.** No tray icon, no auto-launch on login, no installer.
  A human runs this manually per the instructions above.
- **In-flight segment lost on a crash** (not a graceful shutdown). Only
  fully-closed segments are ever written to the queue file; the segment
  open at the moment of an unclean process death (kill -9, power loss) is
  not recovered. A graceful shutdown (Ctrl+C/SIGTERM) does not have this
  problem — see the shutdown handler in `src/index.ts`.
- **No retry queue for screenshots.** Unlike activity segments, a missed
  screenshot cycle (network blip, presign expiry) is just skipped and
  logged — the next cycle ~90 minutes later is the retry. This wasn't
  judged worth a second offline queue for a lower-frequency, best-effort
  signal.
- **The agent doesn't check `window_title_enabled` itself.** It always
  captures and sends whatever title `active-win` reports (except during
  Private Time); the company-wide on/off switch is enforced entirely
  server-side (`ActivitiesService.insertOne()`). This is deliberate, not
  an oversight — the same trust model already used for Private Time's
  redaction (never rely on client good faith alone), and it means the
  agent doesn't need its own copy of the company's privacy settings to
  stay correct if an admin changes them.

## How this was tested

Unit tests (`pnpm --filter agent test`, Node's built-in test runner via
`tsx`) cover the pure orchestration logic — segment open/close decisions
(`activity-tracker.test.ts`), the local queue file
(`queue.test.ts`), batched flush-with-retry-on-failure semantics
(`flush.test.ts`), and the screenshot cycle's 403-is-not-an-error handling
(`screenshot-cycle.test.ts`) — using injected fake functions in place of
`active-win`/`desktop-idle`/`screenshot-desktop`.

**This agent has not been run against a real Windows or macOS machine as
part of building it** — the development environment is a headless Linux
container with no display, and `active-win`/`screenshot-desktop` both
require a real display to do anything. The native adapters in `src/native.ts`
are written directly against each package's documented API and are the
only files in this package with zero test coverage as a result. Running
the enrollment + activity-loop steps above against a real test machine,
and confirming rows land in `devices`/`activities`, is the outstanding
verification step before this is considered proven end-to-end.
