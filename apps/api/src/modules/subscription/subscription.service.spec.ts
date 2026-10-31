import { BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionService } from './subscription.service';
import type { DatabaseService } from '../../database/database.service';
import type { ConfigService } from '@nestjs/config';

describe('SubscriptionService security checks', () => {
  const webhookSecret = 'whsec_test_secret';

  function makeService(env: Record<string, string> = {}) {
    const values: Record<string, string> = {
      'app.frontendUrl': 'https://app.example.com',
      ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:5173',
      ...env,
    };
    const config = { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) };
    const db = { query: jest.fn().mockResolvedValue([{ tier: 'pro' }]) };
    return new SubscriptionService(db as unknown as DatabaseService, config as unknown as ConfigService);
  }

  describe('createCheckoutSession', () => {
    it('allows a returnUrl on the frontend origin', async () => {
      const { url } = await makeService().createCheckoutSession('company-1', 'pro', 'https://app.example.com/settings/billing');
      expect(url).toBe('https://app.example.com/settings/billing?plan=pro&demo=true');
    });

    it('rejects a returnUrl on another origin (open redirect)', async () => {
      await expect(makeService().createCheckoutSession('company-1', 'pro', 'https://evil.example.net/phish'))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('handleStripeWebhook', () => {
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'invoice.paid' });

    it('accepts a correctly signed payload', async () => {
      const svc = makeService({ STRIPE_WEBHOOK_SECRET: webhookSecret });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const event = await svc.handleStripeWebhook(Buffer.from(payload), signature);
      expect(event?.id).toBe('evt_1');
    });

    it('rejects a payload with a forged signature', async () => {
      const svc = makeService({ STRIPE_WEBHOOK_SECRET: webhookSecret });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' });
      await expect(svc.handleStripeWebhook(Buffer.from(payload), signature)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
