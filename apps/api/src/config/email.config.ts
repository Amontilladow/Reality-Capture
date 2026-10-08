import { registerAs } from '@nestjs/config';

// Generic SMTP vars, not tied to any one provider -- Gmail, SES, a
// transactional provider's SMTP endpoint, or a regional/self-hosted one all
// speak plain SMTP, so the code never needs to know or care which is
// actually configured. Same "generic env var, filled in by hand in the
// Render dashboard, sync: false" pattern as S3_*/STRIPE_*/REDIS_PASSWORD in
// render.yaml -- picking the actual provider/account is a deploy-time
// decision, not a code decision.
export default registerAs('email', () => ({
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  smtpFrom: process.env.SMTP_FROM ?? '',
}));
