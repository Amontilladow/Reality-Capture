import { IsOptional, IsString } from 'class-validator';
export class RefreshTokenDto {
  // Optional: the web SPA no longer stores or sends this -- it relies on the
  // httpOnly refresh-token cookie auth.controller.ts reads instead. Only
  // mobile (expo-secure-store, no cookie jar) still sends this in the body.
  @IsOptional()
  @IsString()
  refreshToken?: string;
}