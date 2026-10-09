import { registerAs } from '@nestjs/config';

export default registerAs('microsoftGraph', () => ({
  clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID ?? '',
  clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET ?? '',
  // Which Microsoft accounts may connect. 'organizations' (the default)
  // accepts any work/school (Microsoft 365) account from any organization
  // and deliberately excludes personal Microsoft accounts -- the brief's
  // "do not claim support for every Microsoft account type until tested"
  // and "respect organization policies" both argue against defaulting to
  // 'common' (which would also accept personal @outlook.com/@hotmail.com
  // accounts). Set to a specific Entra tenant ID/domain to restrict this
  // to one organization only.
  tenant: process.env.MICROSOFT_OAUTH_TENANT ?? 'organizations',
  // Must exactly match a redirect URI configured on the Entra App
  // Registration -- e.g.
  // https://engineeringos-api.onrender.com/api/v1/email-integration/outlook/callback
  redirectUri: process.env.MICROSOFT_OAUTH_REDIRECT_URI ?? '',
}));
