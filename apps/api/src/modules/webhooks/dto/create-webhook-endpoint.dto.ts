import { IsUrl, IsArray, ArrayMinSize, IsIn } from 'class-validator';
import { WEBHOOK_EVENT_TYPES } from '../webhook-events';

export class CreateWebhookEndpointDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;

  @IsArray() @ArrayMinSize(1) @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  eventTypes: string[];
}
