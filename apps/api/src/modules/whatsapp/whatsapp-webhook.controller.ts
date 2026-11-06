import { Body, Controller, Get, Headers, Logger, Post, Query, Req, RawBodyRequest, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { DatabaseService } from '../../database/database.service';

interface WhatsAppStatusEntry {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errors?: Array<{ title?: string; message?: string }>;
  biz_opaque_callback_data?: string;
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: { statuses?: WhatsAppStatusEntry[] };
    }>;
  }>;
}

// Meta's inbound webhook for the WhatsApp Business Cloud API: delivers
// delivery-status updates (sent/delivered/read/failed) for messages this
// app sent via WhatsAppService.sendTemplateMessage(). Not reachable
// without a real Meta Business subscription pointed at this URL, and (once
// WHATSAPP_APP_SECRET is set) every payload's signature is verified before
// its content is trusted -- same role as SubscriptionController's own
// Stripe webhook signature check, mirrored here.
@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  // Meta's one-time subscription handshake: echoes hub.challenge back
  // verbatim (as plain text, not a JSON envelope) only if hub.verify_token
  // matches what was configured when the webhook subscription was created
  // in Meta Business Manager.
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    const expected = this.config.get<string>('whatsapp.webhookVerifyToken');
    if (mode === 'subscribe' && expected && token === expected) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
  }

  @Public()
  @Post()
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: WhatsAppWebhookPayload,
  ): Promise<{ received: true }> {
    if (!this.isValidSignature(req.rawBody, signature)) {
      this.logger.warn('WhatsApp webhook signature verification failed -- ignoring payload.');
      return { received: true }; // Ack 200 regardless: Meta retries on non-2xx, which we don't want for a rejected payload.
    }

    const statuses = payload.entry?.flatMap(e => e.changes ?? []).flatMap(c => c.value?.statuses ?? []) ?? [];
    for (const status of statuses) {
      await this.applyStatus(status);
    }
    return { received: true };
  }

  private isValidSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
    const appSecret = this.config.get<string>('whatsapp.appSecret');
    if (!appSecret) return true; // Not yet configured -- nothing live is relying on this check.
    if (!rawBody || !signatureHeader?.startsWith('sha256=')) return false;

    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const provided = signatureHeader.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  private async applyStatus(status: WhatsAppStatusEntry): Promise<void> {
    if (!status.biz_opaque_callback_data) return; // Not one of ours (or sent before this field existed) -- nothing to correlate it to.

    let companyId: string | undefined;
    let deliveryId: string | undefined;
    try {
      const parsed = JSON.parse(status.biz_opaque_callback_data) as { companyId?: string; deliveryId?: string };
      companyId = parsed.companyId;
      deliveryId = parsed.deliveryId;
    } catch {
      return;
    }
    if (!companyId || !deliveryId) return;

    const dbStatus = status.status === 'failed' ? 'failed' : status.status; // sent/delivered/read pass through as-is
    const lastError = status.status === 'failed'
      ? (status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? 'WhatsApp delivery failed') : null;

    try {
      await this.db.withTenant(companyId, sql => sql`
        UPDATE notification_whatsapp_deliveries
        SET status = ${dbStatus}, provider_message_id = ${status.id}, last_error = ${lastError}
        WHERE id = ${deliveryId} AND company_id = ${companyId}
      `);
    } catch (err) {
      this.logger.warn(`Failed to apply WhatsApp status update for delivery ${deliveryId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
