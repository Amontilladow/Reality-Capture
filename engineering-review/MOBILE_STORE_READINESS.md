# Mobile Store Readiness — Android (Google Play) & iOS (Apple App Store)

Status as of this launch-readiness sprint. This document is a checklist, not a
submission plan — nothing in this sprint submitted, signed, or published
anything to either store. Unknowns that only the business/owner can decide
are marked **Needs owner decision**; nothing here is invented on their behalf.

App under review: `apps/mobile` — EngineeringOS Capture, an Expo/React Native
field-capture companion app (camera capture, offline queue, background sync).
It is **not** a full port of the web app's feature set — see
`LAUNCH_READINESS.md` for the web vs. native scope distinction.

---

## 1. App identity

| Item | Android | iOS | Status |
|---|---|---|---|
| App name | "EngineeringOS Capture" (`app.json` `name`) | Same | Set |
| Package / bundle id | `com.engineeringos.capture` | `com.engineeringos.capture` | Set, consistent across platforms |
| Version string | `1.0.0` (`app.json` `version`) | Same | Set |
| Version code / build number | Not hardcoded — `eas.json` sets `cli.appVersionSource: "remote"`, so EAS assigns and increments Android `versionCode`/iOS `buildNumber` automatically per build | Verified present in `eas.json` |
| Production API URL | Was previously reachable through a code path that could silently fall through to `app.json`'s dev value even in a release build. **Fixed this sprint**: `config.ts` now resolves a build's environment (`EXPO_PUBLIC_APP_ENV`, set per `eas.json` profile) and, for `preview`/`production`, requires an explicit `EXPO_PUBLIC_API_BASE_URL` that is validated to reject empty values, `localhost`/`127.0.0.1`/the Android emulator host, `REPLACE_WITH_*`/`example.com`-style placeholders, and (production only) non-HTTPS URLs and bare private-network IPs. `app.json`'s dev URL was also renamed `extra.developmentApiBaseUrl` so its dev-only role is unambiguous from the file alone. Verified with 12 passing unit tests (`apiConfigValidation.test.ts`, run via `pnpm --filter mobile test`). | Same fix, same file — platform-agnostic. |
| App icon | `app.json` references `./assets/icon.png` | Same file | **Still missing** — the `assets/` directory does not exist in the repository at all. Re-verified this sprint via direct file listing, not assumed. Left unchanged: fabricating a placeholder icon is explicitly out of scope. |
| Adaptive icon (Android) | `app.json` references `./assets/adaptive-icon.png` with a background color set | — | **Still missing** — same `assets/` gap |
| Splash screen | `app.json` sets a background color (`#0A141C`) but no splash image | Same | Background-color-only splash is functional but has no logo/brand mark |
| URL scheme | `engineeringos://` (`app.json` `scheme`) | Same | Set |

**Owner action needed for EAS**: before running `eas build --profile preview` or `--profile production`, set `EXPO_PUBLIC_API_BASE_URL` for that profile via `eas env:create --environment preview --name EXPO_PUBLIC_API_BASE_URL --value <real staging URL> --visibility plain` (and the equivalent for `production` with the real HTTPS production URL), or via the EAS dashboard's per-profile environment variables. `EXPO_PUBLIC_APP_ENV` is already set correctly per profile in `eas.json` and needs no owner action. The build will fail fast with a clear error if `EXPO_PUBLIC_API_BASE_URL` is left unset for either profile — this is by design, not a bug to work around.

**Blocker**: no app icon, adaptive icon, or splash image assets exist anywhere
in the repository. This is not a design judgment call — the files are simply
absent. Both stores reject a submission without a valid icon; this must be
supplied by whoever owns the product's visual identity before any real build
is attempted. Nothing was fabricated to paper over this gap.

## 2. Privacy & permissions

| Permission | Declared | Code usage confirmed | User-facing explanation present | Needs owner decision |
|---|---|---|---|---|
| Camera | `app.json` iOS `NSCameraUsageDescription`; Android `CAMERA` | Yes — `CameraScreen.tsx` | Yes, string set on both platforms | — |
| Microphone | iOS: set via the `expo-camera` plugin's `microphonePermission` field in `app.json` (not a direct `infoPlist` key — that's why an earlier pass of this document, checking only `infoPlist` directly, incorrectly reported it missing); Android `RECORD_AUDIO` declared | Used by video capture (`expo-camera` video mode, confirmed in `CameraScreen.tsx`) | **Corrected this sprint**: verified directly against the installed `expo-camera@15.0.16` plugin source (`withCamera.js`), which explicitly writes `NSMicrophoneUsageDescription` from that field. Confirmed present and correct via `npx expo config --type public`, which resolves the plugin and shows `microphonePermission` in its output. No code change was needed — the string was already there. | — |
| Photo library | iOS `NSPhotoLibraryUsageDescription`; Android `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` | Yes — 360° photo import in `CaptureSessionScreen.tsx` via `expo-image-picker` | Yes | See Android storage note below |
| Location (foreground) | iOS `NSLocationWhenInUseUsageDescription`; Android `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` | Yes — GPS tagging on capture (`location.ts`) | Yes | — |
| Location (background) | **Not declared on either platform** | Not used — no background-location code path found | N/A | If background location is never intended, this is correct as-is; flagging only because Phase 4 asked it be checked explicitly. |
| Notifications | Not declared/requested anywhere in the app | Not used | N/A | — |
| Background execution | iOS `UIBackgroundModes: ["fetch","processing"]` | Yes — `expo-background-fetch`/`expo-task-manager` drive the offline-queue sync | Implicit (no separate user-facing string required by Apple for this mode) | — |

**Android storage permission currency**: `app.json` declares the legacy
`READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` permissions. Google Play's
current policy (Android 13/API 33+, scoped storage) treats broad external
storage access as a high-scrutiny declaration and often rejects or flags apps
that request it without a narrow, justified use case (media-type-specific
permissions or the system photo picker are preferred). Since this app's only
storage-adjacent action is picking a single image via `expo-image-picker`
(which can use the system picker without needing these broad permissions on
modern Android), **these permissions should be reviewed for removal** before
a real Play Store submission — this was not changed in this sprint because
removing a permission the app may still depend on for a device/OS
combination in its current Expo SDK version needs an actual on-device check
this sandbox can't perform. **Needs owner/dev decision** after a physical
Android 13+ device test.

**Privacy policy / data-safety form (Play) / privacy nutrition label (App
Store)**: not present anywhere in the repository. **Needs owner decision** —
this is a legal document, not something to draft from source-code inspection
alone, though the code inspection above (camera, mic, photo library,
location, no analytics/ad SDKs found in `package.json`) is the accurate input
an owner or counsel would need to complete one.

## 3. Store assets

| Asset | Status |
|---|---|
| App icon (1024×1024 etc.) | **Does not exist** |
| Screenshots (per device class, per store) | **Do not exist** — none were captured, generated, or fabricated in this sprint |
| Feature graphic (Play) | **Does not exist** |
| Promotional text / description copy | **Does not exist** |
| Privacy policy URL | **Does not exist** |

No screenshots or marketing assets are claimed as complete anywhere in this
document or elsewhere in the repository. All of the above are genuinely
outstanding, owner-level work items, not something this sprint could or
should manufacture.

## 4. Testing

| Item | Status | Notes |
|---|---|---|
| Internal testing track (Play) / TestFlight (iOS) | Not set up | No EAS submit credentials, no store listing exists yet to attach a track to |
| Physical device testing | **Not performed in this sprint** | This sandbox has no physical iOS/Android device or simulator/emulator with camera/GPS hardware access; verified via source inspection and `tsc --noEmit` only, not on-device |
| Permission-denial handling | Verified via source (`CameraScreen.tsx`, `CaptureSessionScreen.tsx`) | Denial shows an explanatory message and does not crash; not confirmed on an actual OS permission-denial dialog |
| Offline behavior | Verified via source (SQLite-backed local queue in `db.ts`, network/auth guards in `sync.ts`) | Not verified under an actual interrupted/degraded network condition on a device — source-level guarantee only |
| Low-network / slow-network behavior | **Not tested** | Serial (not parallel) upload processing is a deliberate design choice per `sync.ts`'s own comments, aimed at thin-connection sites, but its real-world effect on a slow link was not measured |
| App-upgrade path (old version → new version, existing local queue data) | **Not tested** | No migration logic was found for the local SQLite schema; a future schema change to `db.ts`'s tables would need an explicit migration path, which does not currently exist |
| Account deletion | **Not implemented in the app UI** — deletion, if supported at all, would happen via the web app / an admin action, not a native in-app flow. Both stores' current policies (Play's Account Deletion policy, Apple's guideline 5.1.1(v)) require an in-app path to account/data deletion when the app supports account creation. **Needs owner decision**: either add an in-app deletion path or confirm the web app's path satisfies both stores' requirements for an app that itself does not create accounts (the mobile app only ever logs into an account created via the web app's company-registration flow). |
| Crash recovery | Not instrumented — **no crash reporting (Sentry, Crashlytics, etc.) is wired into the mobile app.** This is a real gap for post-launch operations, not just store submission. |

## 5. Release operations

| Item | Status |
|---|---|
| Signed build ownership | **Needs owner decision.** No signing credentials, keystores, or certificates exist in this repository (correctly — they must never be committed), and none were requested, generated, or handled in this sprint. Whoever owns the Apple Developer account / Google Play Console account must generate and hold these themselves via `eas credentials` or manually. |
| Keystore / certificate custody | **Needs owner decision** — establish who holds the Android upload keystore and the iOS distribution certificate/provisioning profile before the first real build. Losing the Android upload key is unrecoverable without going through Google's key-upgrade process; this should be backed up somewhere durable and access-controlled from day one. |
| Secret storage for CI/EAS | **Corrected this sprint**: `eas.json`'s `preview`/`production` profiles previously committed literal placeholder URLs (`REPLACE_WITH_STAGING_API_URL` / `REPLACE_WITH_PRODUCTION_API_URL`); these have been removed entirely rather than left as accept-if-unfixed placeholders. Each profile now only sets `EXPO_PUBLIC_APP_ENV`; the real `EXPO_PUBLIC_API_BASE_URL` must be supplied via EAS's own encrypted per-profile environment variable store (`eas env:create`) at build time — see the App Identity section above for the exact command. `config.ts` fails the build/startup loudly if it's missing, so there's no way to accidentally ship without it. |
| Version/build process | EAS Build with three profiles (development/preview/production) now exists (`apps/mobile/eas.json`, added this sprint). `appVersionSource: "remote"` means EAS — not this repo — is the source of truth for the Android version code and iOS build number. |
| Rollback / hotfix process | **Not defined.** Expo's OTA update mechanism (`expo-updates`) is not currently configured in this app — there is no fast-patch path for a JS-only bug short of a full store resubmission. **Needs owner decision**: adopt EAS Update for OTA patching, or accept store-review turnaround as the only rollback/hotfix path. |
| Support contact | **Not defined anywhere in the app or store metadata (neither exists yet).** Both stores require a support contact/URL at listing time. **Needs owner decision.** |
| Incident response | **Not defined.** No crash reporting (see above) and no defined on-call/escalation process for a native-app-specific incident (e.g., a bad build that corrupts the local queue) were found or created in this sprint. |

---

## Still requiring owner or external action

None of the following are resolved by this document existing. Each needs a
real decision, a real device, or a real console this sandbox cannot reach:

- Production database role with password, grants, and `rolbypassrls = false` (see `LAUNCH_READINESS.md`)
- Verification of table ownership and RLS behavior under the actual application role
- Production backup retention and restore drill
- Redis/object-storage monitoring and alerting (an endpoint now exists — see `LAUNCH_READINESS.md`'s Monitoring row — but nothing polls or alerts on it yet)
- Crash reporting choice (Sentry, Crashlytics, or equivalent) — none wired in
- Support contact and incident-response process
- Privacy policy and terms of service
- Data deletion / account deletion behavior (both stores' current policies require an in-app path or a clear equivalent)
- Android signing ownership (upload keystore custody and backup)
- iOS certificate/provisioning profile ownership
- EAS secret/environment ownership (who holds `eas env:create` access for preview/production)
- Store listing assets: icon, adaptive icon, splash image, screenshots, feature graphic, description copy
- Physical Android device testing
- Physical iPhone testing
- Physical iPad/tablet testing
- Google Play internal testing track setup
- TestFlight setup

## Store readiness verdict

**Android public store release: NOT READY.** **iOS App Store release: NOT
READY.** Both remain NOT READY regardless of the fixes made this sprint —
those fixes closed code-level gaps (the API-URL fail-safe, confirming the
microphone string was actually fine), not the asset/device/policy/signing
work above, none of which this sprint could complete. Do not upgrade either
verdict until the actual assets, device tests, store metadata, privacy
materials, and signing process exist — code fixes and documentation are not
a substitute for any of them.

## Summary

Nothing in this document should be read as "ready to submit." The concrete,
verified blockers are: missing app icon/adaptive-icon/splash assets, legacy
Android storage permissions that should be reviewed against current Play
policy, no privacy policy/data-safety materials, no crash reporting, no
signing/credential ownership decided, and no store listing assets of any
kind. (The iOS microphone usage string, previously reported missing here,
was re-verified this sprint and is actually present and correct — see the
Privacy & Permissions section.) All of the above are either owner-level
decisions or require a real device/store-console step this sandbox cannot
perform — they are listed here precisely so they aren't silently discovered
at submission time.
