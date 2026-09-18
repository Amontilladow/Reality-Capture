import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { AgentConfig } from './types.js';

export const CONFIG_DIR = process.env.AGENT_CONFIG_DIR ?? join(homedir(), '.reality-capture-agent');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const QUEUE_PATH = join(CONFIG_DIR, 'queue.jsonl');
// Presence of this file, not its contents, is the on/off switch -- a
// plain marker file rather than a field in config.json so `agent private
// on|off` (run as a short-lived one-off process, same as `enroll`) can
// flip it without racing the long-lived `start` process's own config
// reads/writes. The running `start` loop just checks existsSync() on
// every sample tick (see index.ts) -- no IPC/socket needed for a plain
// Node process with no tray icon.
export const PRIVATE_MODE_PATH = join(CONFIG_DIR, 'private-mode');

const DEFAULTS = { screenshotIntervalMinutes: 90, idleThresholdSeconds: 120 };

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): AgentConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`No agent config found at ${CONFIG_PATH}. Run "pnpm --filter agent enroll" first.`);
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  return { ...DEFAULTS, ...raw };
}

// Plaintext-on-disk is an MVP shortcut, not an oversight: the architecture
// doc (docs/workforce-intelligence-architecture.md) already flags
// per-device token auth as a deferred V1 hardening item, not something
// MVP needs -- this agent authenticates as the enrolling user's own
// account, the same way a browser tab's localStorage holds a JWT in
// plaintext too. chmod 600 restricts it to the owning OS user, which is
// the meaningful protection available without building real OS-keychain
// integration (skipped here as a genuine scope expansion -- keychain APIs
// differ per OS and need their own native bindings -- not a trivial add).
export function saveConfig(config: AgentConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
}

export function updateTokens(accessToken: string, refreshToken: string): void {
  const config = loadConfig();
  saveConfig({ ...config, accessToken, refreshToken });
}

// `path` defaults to the real marker file but is overridable, same as
// queue.ts's functions, so tests can exercise this against a temp
// directory instead of the real (or env-var-overridden) CONFIG_DIR.
export function isPrivateModeOn(path: string = PRIVATE_MODE_PATH): boolean {
  return existsSync(path);
}

export function setPrivateMode(on: boolean, path: string = PRIVATE_MODE_PATH): void {
  if (on) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(path, '');
  } else if (existsSync(path)) {
    rmSync(path);
  }
}
