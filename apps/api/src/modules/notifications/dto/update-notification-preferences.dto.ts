import { IsOptional, IsBoolean, IsArray, IsIn } from 'class-validator';
import { NOTIFICATION_CATEGORIES } from '../notifications.service';

export class UpdateNotificationPreferencesDto {
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() whatsappEnabled?: boolean;
  @IsOptional() @IsArray() @IsIn(NOTIFICATION_CATEGORIES, { each: true }) mutedCategories?: string[];
}
