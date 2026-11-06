import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../store/auth.store';
import { refreshAccessToken } from './api';

// Singleton Socket.io connection for real-time in-app notifications
// (namespace /notifications) -- mirrors chat-socket.ts's own singleton
// exactly (same base-URL resolution, same token-change teardown/reconnect,
// same server-disconnect -> refresh-and-reconnect handling); see that
// file's own comments for why each piece works the way it does.
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
let refreshedAfterDisconnect: string | null = null;

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
  socket = io(`${SOCKET_BASE_URL}/notifications`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
  currentToken = token;
  socket.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect' || refreshedAfterDisconnect === token) return;
    refreshedAfterDisconnect = token;
    void refreshAccessToken();
  });
}

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

syncSocketWithAuth();
useAuthStore.subscribe((state, prevState) => {
  if (state.accessToken !== prevState.accessToken) {
    syncSocketWithAuth();
  }
});

export function subscribeToNotificationSocket(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotificationSocketSnapshot(): Socket | null {
  return socket;
}
