import { registerAs } from '@nestjs/config';

// WhatsApp Business Cloud API (Meta). Same "generic env var, filled in by
// hand in the Render dashboard, sync: false" pattern as email.config.ts's
// own SMTP_* vars -- the account, phone number, and pre-approved message
// template are all deploy-time decisions made in Meta Business Manager,
// not code decisions. Every value here defaults to '', and
// WhatsAppService.isConfigured() treats that as "channel not live yet":
// per the master spec's zero-unapproved-cost requirement, nothing sends
// and nothing is even queued until an operator has gone through Meta's
// Business verification and filled these in for real.
export default registerAs('whatsapp', () => ({
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
  apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
  // The name/language of the pre-approved outbound template this app sends
  // (Meta requires message-template, not free-form text, for any
  // business-initiated message outside a 24h customer-service window --
  // which every RealityCapture notification is). The template must be
  // created and approved in Meta Business Manager with exactly two body
  // placeholders (notification title, then body) before this is usable.
  templateName: process.env.WHATSAPP_TEMPLATE_NAME ?? '',
  templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en_US',
  // Verifies Meta's webhook subscription handshake (hub.verify_token) and,
  // separately, WHATSAPP_APP_SECRET signs inbound delivery-status payloads
  // (X-Hub-Signature-256) -- same role as Stripe's webhook secret.
  webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '',
  appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
}));
