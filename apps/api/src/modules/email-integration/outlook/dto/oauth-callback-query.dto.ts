import { IsOptional, IsString } from 'class-validator';

export class EmailOAuthCallbackQueryDto {
  @IsOptional() @IsString()
  code?: string;

  @IsOptional() @IsString()
  state?: string;

  // Set instead of `code` when the user declines consent (Microsoft:
  // 'access_denied') -- not an error in our system, just an outcome to
  // redirect back to the frontend with. Same shape as Calendar's own
  // callback DTO.
  @IsOptional() @IsString()
  error?: string;
}
