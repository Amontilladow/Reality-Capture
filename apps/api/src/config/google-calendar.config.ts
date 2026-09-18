import { registerAs } from '@nestjs/config';
export default registerAs('googleCalendar', () => ({
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  // Must exactly match a redirect URI configured in the Google Cloud
  // Console OAuth client -- e.g. https://engineeringos-api.onrender.com/api/v1/workforce/calendar-integration/google-calendar/callback
  redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? '',
}));
