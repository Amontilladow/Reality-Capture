import axios from 'axios';
import { hostname, platform } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { saveConfig } from './config.js';

const AGENT_VERSION = '0.1.0';

// process.platform -> the DEVICE_PLATFORMS vocabulary
// (packages/types/src/workforce.types.ts). Anything not win32/darwin
// falls back to 'linux', matching EnrollDeviceDto's closed IsIn check.
const PLATFORM_MAP: Record<string, string> = { win32: 'windows', darwin: 'macos', linux: 'linux' };

// One-time enrollment: log in with the existing auth flow (there is no
// separate device-token auth yet -- see docs/workforce-intelligence-
// architecture.md's V1 hardening item list), self-enroll a device under
// that user, and persist the session + deviceId locally. Accepts
// AGENT_SERVER_URL/AGENT_EMAIL/AGENT_PASSWORD as env vars for scripted
// setup (recommended -- see README.md); falls back to interactive,
// unmasked prompts otherwise, which is fine for a manually-run local test
// client but not something to rely on for a real rollout.
export async function enroll(): Promise<void> {
  const serverUrl = process.env.AGENT_SERVER_URL ?? (await prompt('Server URL (e.g. https://engineeringos-api.onrender.com/api/v1): '));
  const email = process.env.AGENT_EMAIL ?? (await prompt('Email: '));
  const password = process.env.AGENT_PASSWORD ?? (await prompt('Password: '));

  const client = axios.create({ baseURL: serverUrl });

  const loginRes = await client.post('/auth/login', { email, password });
  const { tokens } = loginRes.data.data as { tokens: { accessToken: string; refreshToken: string } };

  const detectedPlatform = PLATFORM_MAP[platform()] ?? 'linux';
  const deviceRes = await client.post(
    '/workforce/devices',
    { platform: detectedPlatform, hostname: hostname(), agentVersion: AGENT_VERSION },
    { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
  );
  const deviceId = deviceRes.data.data.id as string;

  saveConfig({
    serverUrl,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    deviceId,
    screenshotIntervalMinutes: 90,
    idleThresholdSeconds: 120,
  });

  console.log(`Enrolled device ${deviceId} (${detectedPlatform}, ${hostname()}) for ${email}.`);
  console.log('Config saved. Run "pnpm --filter agent start" to begin tracking.');
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
