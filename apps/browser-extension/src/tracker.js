// Pure segment-tracking logic, deliberately with zero chrome.* API calls --
// mirrors apps/agent/src/activity-tracker.ts's ActivityTracker exactly
// (same "one open segment, close-and-reopen on change" model), adapted for
// domain instead of application name. Kept dependency-free so it can be
// unit-tested with node's built-in test runner, without a real browser.
//
// Unlike the desktop agent, this is event-driven, not polled: background.js
// calls recordState() from chrome.tabs/windows/idle event listeners, not a
// setInterval loop -- Manifest V3 service workers get suspended between
// events anyway, so polling on a timer isn't reliable in the way it is for
// the desktop agent's own long-lived Node process.

export const PRIVATE_DOMAIN_NAME = 'Private';

export class DomainTracker {
  #openSegment = null;

  // `domain` should already be the resolved hostname (see
  // background.js's extractDomain()), or PRIVATE_DOMAIN_NAME while private
  // mode is on, or 'idle' while activityType is 'IDLE' -- this class makes
  // no judgment about what the caller passes, only when segments open/close.
  recordState(domain, activityType, now) {
    if (!this.#openSegment) {
      this.#openSegment = { domain, activityType, startedAt: now };
      return null;
    }
    const unchanged = this.#openSegment.domain === domain && this.#openSegment.activityType === activityType;
    if (unchanged) return null;

    const closed = { ...this.#openSegment, endedAt: now };
    this.#openSegment = { domain, activityType, startedAt: now };
    return closed;
  }

  // Mirrors ActivityTracker.closeCurrent() -- called before the service
  // worker is expected to go away (e.g. on a suspend/flush cycle) so an
  // in-progress segment isn't silently dropped. Since MV3 service workers
  // can be killed without any shutdown signal at all (unlike the desktop
  // agent's SIGINT/SIGTERM handler), background.js also persists the open
  // segment via toPersisted()/fromPersisted() so it survives an unclean
  // suspension, not just a graceful one.
  closeCurrent(now) {
    if (!this.#openSegment) return null;
    const closed = { ...this.#openSegment, endedAt: now };
    this.#openSegment = null;
    return closed;
  }

  // For persisting/restoring the open segment across a service-worker
  // suspend/wake cycle via chrome.storage.local (see storage.js) --
  // service workers do not keep in-memory class state alive between
  // events the way the desktop agent's single long-lived process does.
  toPersisted() {
    return this.#openSegment;
  }

  fromPersisted(segment) {
    this.#openSegment = segment ?? null;
  }
}
