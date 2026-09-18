import { IsOptional, IsString } from 'class-validator';

export class OAuthCallbackQueryDto {
  @IsOptional() @IsString()
  code?: string;

  @IsOptional() @IsString()
  state?: string;

  // Google sets this instead of `code` when the user declines consent --
  // e.g. 'access_denied'. Not an error in our system, just an outcome to
  // redirect back to the frontend with.
  @IsOptional() @IsString()
  error?: string;
}
