import { IsBoolean } from 'class-validator';

export class SetWebhookActiveDto {
  @IsBoolean()
  isActive: boolean;
}
