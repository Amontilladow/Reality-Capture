import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { resolveAppEnv, validateApiBaseUrlForEnv, type AppEnv } from './apiConfigValidation';

/**
 * Which of eas.json's three build profiles produced this running app.
 * Read from EXPO_PUBLIC_APP_ENV, which each profile's `env` sets explicitly
 * (see eas.json). __DEV__ (true only for a local Metro/Expo-Go bundle) is
 * the fallback when that var is absent -- and a *release* build with no
 * profile marker at all is treated as "production", the strictest profile,
 * rather than silently falling back to a permissive one.
 */
export const APP_ENV: AppEnv = resolveAppEnv(process.env.EXPO_PUBLIC_APP_ENV, __DEV__);

/**
 * The API base URL. In Expo Go / dev builds, "localhost" refers to the phone
 * itself, not your dev machine — so this must point at your machine's LAN IP
 * (or 10.0.2.2 for the Android emulator) when running on a real device.
 *
 * Override without a rebuild: set EXPO_PUBLIC_API_BASE_URL before `expo start`,
 * e.g. `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000/api/v1 expo start`.
 */
function resolveApiBaseUrl(): string {
  const envOverride = process.env.EXPO_PUBLIC_API_BASE_URL;

  if (envOverride) {
    validateApiBaseUrlForEnv(envOverride, APP_ENV);
    if (APP_ENV === 'development' && Platform.OS === 'android' && envOverride.includes('localhost')) {
      // Android emulator's loopback to the host machine.
      return envOverride.replace('localhost', '10.0.2.2');
    }
    return envOverride;
  }

  if (APP_ENV !== 'development') {
    // A preview/production release build with no EXPO_PUBLIC_API_BASE_URL
    // set at all must fail here, loudly, at startup -- it must NEVER fall
    // through to app.json's `extra.developmentApiBaseUrl` below, which is a
    // local-development-only convenience value (currently localhost).
    throw new Error(
      `No EXPO_PUBLIC_API_BASE_URL configured for a "${APP_ENV}" build. Set it in eas.json's ` +
      `"${APP_ENV}" build profile "env" (or via "eas env:create") before building -- see ` +
      'MOBILE_STORE_READINESS.md for the exact variable name and how EAS should supply it.',
    );
  }

  // Development, no explicit override: app.json's extra.developmentApiBaseUrl
  // (or the localhost fallback below) is a local-dev-only convenience. This
  // branch is unreachable for a preview/production build, whatever app.json
  // contains -- see the `APP_ENV !== 'development'` branch above.
  const configured = (Constants.expoConfig?.extra?.developmentApiBaseUrl as string | undefined) ?? '';
  if (Platform.OS === 'android' && configured.includes('localhost')) {
    return configured.replace('localhost', '10.0.2.2');
  }

  return configured || 'http://localhost:3000/api/v1';
}

export const API_BASE_URL = resolveApiBaseUrl();

export const SYNC_TASK_NAME = 'engineeringos-background-sync';
export const SYNC_MIN_INTERVAL_SECONDS = 15 * 60; // OS enforces its own minimum (~15 min) regardless
export const MAX_UPLOAD_RETRIES = 5;
