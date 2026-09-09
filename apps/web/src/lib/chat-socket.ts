import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './api';
import { useAuthStore } from '../store/auth.store';

// Singleton Socket.io connection for the live chat widget (namespace /chat).
// Connected once the user is authenticated, and torn down + recreated
// whenever the access token changes -- including a silent refresh performed
// by the response interceptor in api.ts -- so we never sit on a socket
// authenticated with a stale/expiring token.

// ── Resolving the Socket.io server's base URL ──────────────────────────────
//
// API_BASE is the REST base (`/api/v1` in dev via the Vite proxy, or a full
// `VITE_API_BASE` URL in production). The chat gateway is mounted as a
// Socket.io namespace off the API host's root, not under /api/v1, so this
// needs the *origin* the REST calls resolve to, not API_BASE itself.
//
// In production, VITE_API_BASE is set at build time to the deployed API's
// full URL (e.g. https://api.example.com/api/v1) -- stripping it down to
// its origin gives the right host for both REST and the socket.
//
// In dev, VITE_API_BASE is unset and API_BASE falls back to the *relative*
// path '/api/v1', proxied by Vite's dev server to http://localhost:3000
// (see apps/web/vite.config.ts `server.proxy['/api']`). That proxy entry
// only matches the '/api' prefix -- Socket.io's own handshake (an initial
// HTTP long-poll to /socket.io/... followed by the websocket upgrade) does
// not go through that rule at all, since its path doesn't start with /api.
// So in dev there is no proxied path that gets a socket connection to the
// backend: it must connect directly to http://localhost:3000 (the same
// target the /api proxy rule itself points at), not through the Vite dev
// server on :5173.
function resolveSocketBaseUrl(): string {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  if (envBase && /^https?:\/\//i.test(envBase)) {
    return new URL(envBase).origin;
  }
  return 'http://localhost:3000';
}

const SOCKET_BASE_URL = resolveSocketBaseUrl();

let socket: Socket | null = null;
let currentToken: string | null = null;

const listeners = new Set<() => void>();
function notifyListeners() {
  listeners.forEach((l) => l());
}

function teardownSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentToken = null;
}

function connectSocket(token: string) {
  socket = io(`${SOCKET_BASE_URL}/chat`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
  currentToken = token;
}

// Keeps the singleton socket's identity in sync with the auth store's
// current access token: no token -> disconnected; a new/changed token ->
// disconnect the old socket and open a fresh, correctly-authenticated one.
function syncSocketWithAuth() {
  const token = useAuthStore.getState().accessToken;

  if (!token) {
    if (socket) {
      teardownSocket();
      notifyListeners();
    }
    return;
  }

  if (socket && currentToken === token) return;

  teardownSocket();
  connectSocket(token);
  notifyListeners();
}

// Establish (or clear) the initial connection based on whatever token is
// already in the store at module-load time, then keep it in sync going
// forward.
syncSocketWithAuth();
useAuthStore.subscribe((state, prevState) => {
  if (state.accessToken !== prevState.accessToken) {
    syncSocketWithAuth();
  }
});

// React-friendly accessors (for useSyncExternalStore) -- the socket
// *instance* changes identity on reconnect/token-change, so components that
// hold a reference need to know when to pick up the new one.
export function subscribeToChatSocket(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatSocketSnapshot(): Socket | null {
  return socket;
}
