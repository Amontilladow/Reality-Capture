import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WhatsAppSendResult {
  messageId: string;
}

// WhatsApp Business Cloud API client (Meta Graph API). Scaffolding only
// until real Meta Business credentials are configured -- see
// whatsapp.config.ts's own comment and the master spec's section 10
// zero-unapproved-cost requirement. isConfigured() is the single gate
// every caller (NotificationsService, this module's own controller) must
// check before attempting to use this service for anything that would
// incur cost or require live credentials.
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('whatsapp.businessAccountId')
      && this.config.get<string>('whatsapp.phoneNumberId')
      && this.config.get<string>('whatsapp.accessToken')
      && this.config.get<string>('whatsapp.templateName'),
    );
  }

  // Sends the pre-approved notification template (two body placeholders:
  // title, then body) to `to` (E.164 digits, no leading '+'). Meta requires
  // a template -- not a free-form text message -- for any business-
  // initiated message outside a 24h customer-service window, which is
  // every notification this app sends. `opaqueCallbackData` is echoed back
  // verbatim on every delivery-status webhook for this message
  // (WhatsAppWebhookController reads it to find the right delivery row
  // without needing any other correlation).
  async sendTemplateMessage(to: string, titleText: string, bodyText: string, opaqueCallbackData: string): Promise<WhatsAppSendResult> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp Business API is not configured (WHATSAPP_BUSINESS_ACCOUNT_ID/WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN/WHATSAPP_TEMPLATE_NAME) -- cannot send WhatsApp message.');
    }

    const phoneNumberId = this.config.get<string>('whatsapp.phoneNumberId');
    const apiVersion = this.config.get<string>('whatsapp.apiVersion');
    const accessToken = this.config.get<string>('whatsapp.accessToken');
    const templateName = this.config.get<string>('whatsapp.templateName');
    const templateLanguage = this.config.get<string>('whatsapp.templateLanguage');

    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: titleText },
              { type: 'text', text: bodyText },
            ],
          }],
        },
        biz_opaque_callback_data: opaqueCallbackData,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp API responded ${response.status}: ${errorBody}`);
    }

    const data = await response.json() as { messages?: Array<{ id: string }> };
    const messageId = data.messages?.[0]?.id;
    if (!messageId) throw new Error('WhatsApp API response did not include a message id.');

    this.logger.log(`WhatsApp template message sent to ${to} (id ${messageId})`);
    return { messageId };
  }
}
