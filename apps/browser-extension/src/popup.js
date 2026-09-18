// Popup UI glue -- not unit-tested (DOM + chrome.storage.local, same
// reasoning as background.js). Enrollment reuses the exact same
// /auth/login + POST /workforce/devices flow apps/agent/src/enroll.ts
// uses, just via a form instead of an interactive terminal prompt.
import { loadState, saveState } from './storage.js';
import { login, enrollDevice } from './api-client.js';

const els = {
  form: document.getElementById('enrollForm'),
  serverUrl: document.getElementById('serverUrl'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  enrollButton: document.getElementById('enrollButton'),
  privateToggle: document.getElementById('privateToggle'),
  status: document.getElementById('status'),
};

async function refreshStatus() {
  const state = await loadState(chrome.storage.local);
  els.privateToggle.checked = !!state.privateMode;
  if (state.deviceId) {
    els.form.style.display = 'none';
    els.status.textContent = `Enrolled (device ${state.deviceId.slice(0, 8)}…). Tracking the active tab's domain.`;
  } else {
    els.status.textContent = 'Not enrolled yet.';
  }
}

els.enrollButton.addEventListener('click', async () => {
  els.enrollButton.disabled = true;
  els.status.textContent = 'Enrolling…';
  try {
    const serverUrl = els.serverUrl.value.trim().replace(/\/$/, '');
    if (!serverUrl || !els.email.value.trim() || !els.password.value) {
      throw new Error('Server URL, email, and password are all required.');
    }
    const tokens = await login(serverUrl, els.email.value.trim(), els.password.value);
    const deviceId = await enrollDevice(serverUrl, tokens.accessToken);
    await saveState(chrome.storage.local, {
      serverUrl, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, deviceId,
    });
    await refreshStatus();
  } catch (err) {
    els.status.textContent = `Enrollment failed: ${err.message}`;
  } finally {
    els.enrollButton.disabled = false;
  }
});

els.privateToggle.addEventListener('change', async () => {
  await saveState(chrome.storage.local, { privateMode: els.privateToggle.checked });
});

refreshStatus();
