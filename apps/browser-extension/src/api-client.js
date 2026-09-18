// Thin fetch-based client mirroring apps/agent/src/api-client.ts's
// single-flight-refresh-on-401 pattern (axios there, native fetch here --
// no bundler in this package, and fetch is available in a Manifest V3
// service worker without any extra dependency). Not unit-tested, same as
// the desktop agent's own api-client.ts wasn't -- this is network glue,
// not the segment-tracking decision logic (see tracker.js/tracker.test.js
// and domain.js/domain.test.js for what actually is unit-tested here).

export async function login(serverUrl, email, password) {
  const res = await fetch(`${serverUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.data.tokens;
}

// platform: 'web' -- already a valid DEVICE_PLATFORMS value (packages/
// types/src/workforce.types.ts), anticipated since the MVP schema but
// never used by a real client until this package.
export async function enrollDevice(serverUrl, accessToken) {
  const res = await fetch(`${serverUrl}/workforce/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ platform: 'web', hostname: 'browser-extension' }),
  });
  if (!res.ok) throw new Error(`Device enrollment failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.data.id;
}

// `state` supplies serverUrl/accessToken/refreshToken; `onTokensRefreshed`
// is called with the new pair so the caller can persist them (background.js
// wires this to saveState()) -- mirrors updateTokens() in the agent.
export function createApiClient(state, onTokensRefreshed) {
  let accessToken = state.accessToken;
  let refreshToken = state.refreshToken;
  let refreshPromise = null;

  async function authedFetch(path, options) {
    const attempt = (token) => fetch(`${state.serverUrl}${path}`, {
      ...options,
      headers: { ...(options?.headers ?? {}), 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });

    let res = await attempt(accessToken);
    if (res.status === 401) {
      if (!refreshPromise) {
        refreshPromise = fetch(`${state.serverUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
          .then((r) => r.json())
          .then(async (body) => {
            const tokens = body.data.tokens;
            accessToken = tokens.accessToken;
            refreshToken = tokens.refreshToken;
            await onTokensRefreshed(tokens.accessToken, tokens.refreshToken);
          })
          .finally(() => { refreshPromise = null; });
      }
      await refreshPromise;
      res = await attempt(accessToken);
    }
    return res;
  }

  return {
    async ingestActivities(items) {
      const res = await authedFetch('/workforce/activities/ingest', { method: 'POST', body: JSON.stringify({ activities: items }) });
      if (!res.ok) throw new Error(`Ingest failed: HTTP ${res.status}`);
      const body = await res.json();
      return body.data;
    },
  };
}
