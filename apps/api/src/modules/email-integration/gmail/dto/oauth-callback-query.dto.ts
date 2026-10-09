import { IsOptional, IsString } from 'class-validator';

export class EmailOAuthCallbackQueryDto {
  @IsOptional() @IsString()
  code?: string;

  @IsOptional() @IsString()
  state?: string;

  // Google sets this instead of `code` when the user declines consent --
  // e.g. 'access_denied'. Not an error in our system, just an outcome to
  // redirect back to the frontend with. Same shape as Outlook's own
  // callback DTO (Phase 3C) and Calendar's.
  @IsOptional() @IsString()
  error?: string;
}
