// Pure validation logic for the native app's API base URL, kept free of any
// react-native/expo imports so it can run under a plain Node test runner
// (see apiConfigValidation.test.ts) without needing a full RN/Expo test
// environment. config.ts is the only caller that wires this up to the
// actual Expo/RN runtime (__DEV__, Constants.expoConfig, Platform).

export type AppEnv = 'development' | 'preview' | 'production';

// Matches an EAS build profile's env var to a known app environment. A
// release build (eas build --profile preview|production) is expected to set
// EXPO_PUBLIC_APP_ENV explicitly in that profile's `env` (see eas.json); a
// release build with no such marker is treated as "production" -- the
// strictest profile -- rather than silently falling back to a permissive one.
export function resolveAppEnv(rawAppEnv: string | undefined, isDevRuntime: boolean): AppEnv {
  if (rawAppEnv === 'development' || rawAppEnv === 'preview' || rawAppEnv === 'production') {
    return rawAppEnv;
  }
  return isDevRuntime ? 'development' : 'production';
}

const PLACEHOLDER_OR_LOCAL_PATTERNS: RegExp[] = [
  /^REPLACE_WITH_/i,
  /example\.(com|org|net)/i,
  /localhost/i,
  /127\.0\.0\.1/,
  /10\.0\.2\.2/, // Android emulator's loopback to the host machine
];

export function isPlaceholderOrLocalUrl(url: string): boolean {
  return PLACEHOLDER_OR_LOCAL_PATTERNS.some((pattern) => pattern.test(url));
}

// 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 -- private-network ranges that
// have no business being a *public* production API endpoint. Only enforced
// for "production", not "preview": a staging server reachable over a VPN on
// a private address is a legitimate, common setup for an internal build.
const PRIVATE_IP_PATTERN = /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/;

/**
 * Throws if `url` is not an acceptable API base URL for `env`.
 *
 * - "development": any non-empty value is accepted (including localhost/LAN
 *   addresses -- that's the point of local development).
 * - "preview": must be non-empty and not an obvious placeholder/local
 *   address; HTTP is allowed (an internal staging server may not have TLS).
 * - "production": all of the above, plus must be HTTPS and must not be a
 *   bare private-network IP address.
 */
export function validateApiBaseUrlForEnv(url: string, env: AppEnv): void {
  if (!url) {
    throw new Error(`No API base URL configured for a "${env}" build.`);
  }
  if (env === 'development') return;

  if (isPlaceholderOrLocalUrl(url)) {
    throw new Error(
      `Refusing to use "${url}" as the API base URL for a "${env}" build -- ` +
      `it looks like a placeholder or a local-development address, not a real ${env} endpoint.`,
    );
  }

  if (env === 'production') {
    if (!url.startsWith('https://')) {
      throw new Error(`Production build requires an HTTPS API base URL, got: "${url}"`);
    }
    if (PRIVATE_IP_PATTERN.test(url)) {
      throw new Error(
        `Refusing to use a private-network address ("${url}") as the production API base URL. ` +
        `If this is intentional (e.g. a VPN-only production deployment), that needs a clearly ` +
        `documented, separate build profile -- not the standard "production" one.`,
      );
    }
  }
}
