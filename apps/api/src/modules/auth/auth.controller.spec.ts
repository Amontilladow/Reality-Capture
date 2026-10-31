import { AuthController } from './auth.controller';

// @nestjs/throttler doesn't export these two metadata keys from its public
// entry point (only from an internal dist path) -- their values are part of
// the library's stable decorator contract (see Throttle()'s implementation
// in throttler.decorator.js), so they're inlined here rather than reaching
// into @nestjs/throttler/dist/throttler.constants directly.
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

// Verifies the unauthenticated credential-guessing surface runs under a
// stricter 10 req/min limit than the 100 req/min app-wide default. The limit
// is an override of the single 'default' throttler (app.module.ts): in
// @nestjs/throttler v5 a second named bucket would be enforced on EVERY
// route, not just the ones that reference it.
describe('AuthController rate limiting', () => {
  const guessableRoutes: Array<[string, keyof AuthController]> = [
    ['login', 'login'],
    ['refresh', 'refresh'],
    ['accept-invitation', 'acceptInvitation'],
    ['self-signup', 'selfSignup'],
    ['forgot-password', 'forgotPassword'],
    ['reset-password', 'resetPassword'],
  ];

  it.each(guessableRoutes)('%s is throttled at 10 req/min', (_name, method) => {
    const handler = AuthController.prototype[method] as unknown as object;
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler)).toBe(10);
    expect(Reflect.getMetadata(THROTTLER_TTL + 'default', handler)).toBe(60_000);
  });
});
