import { AuthController } from './auth.controller';

// @nestjs/throttler doesn't export these two metadata keys from its public
// entry point (only from an internal dist path) -- their values are part of
// the library's stable decorator contract (see Throttle()'s implementation
// in throttler.decorator.js), so they're inlined here rather than reaching
// into @nestjs/throttler/dist/throttler.constants directly.
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

// Verifies the stricter 'auth' throttler bucket (defined in app.module.ts's
// ThrottlerModule.forRoot() as 10 req/min, vs. the 100 req/min 'default'
// bucket every other route gets) is actually applied to the unauthenticated
// credential-guessing surface. The bucket previously existed but was never
// referenced by any @Throttle() decorator, so every auth route silently ran
// under the same 100 req/min limit as the rest of the API.
describe('AuthController rate limiting', () => {
  const guessableRoutes: Array<[string, keyof AuthController]> = [
    ['login', 'login'],
    ['refresh', 'refresh'],
    ['forgot-password', 'forgotPassword'],
    ['reset-password', 'resetPassword'],
  ];

  it.each(guessableRoutes)('%s is throttled under the stricter "auth" bucket', (_name, method) => {
    const handler = AuthController.prototype[method] as unknown as object;
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'auth', handler)).toBe(10);
    expect(Reflect.getMetadata(THROTTLER_TTL + 'auth', handler)).toBe(60_000);
  });
});
