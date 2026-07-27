import Constants from 'expo-constants';
import { Platform } from 'react-native';

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
  if (envOverride) return envOverride;

  const configured = (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? '';

  if (Platform.OS === 'android' && configured.includes('localhost')) {
    // Android emulator's loopback to the host machine.
    return configured.replace('localhost', '10.0.2.2');
  }
  return configured || 'http://localhost:3000/api/v1';
}

export const API_BASE_URL = resolveApiBaseUrl();

export const SYNC_TASK_NAME = 'engineeringos-background-sync';
export const SYNC_MIN_INTERVAL_SECONDS = 15 * 60; // OS enforces its own minimum (~15 min) regardless
export const MAX_UPLOAD_RETRIES = 5;
