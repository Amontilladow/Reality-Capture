import {
  Controller, Post, Body, Get, HttpCode, HttpStatus, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import ms from 'ms';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { SelfSignupDto } from './dto/self-signup.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AllowPending } from '../../common/decorators/allow-pending.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

// httpOnly refresh-token cookie for the web SPA -- see auth.store.ts (apps/web)
// for why: a refresh token readable by page-context JavaScript (localStorage)
// is a one-shot account-takeover target for any future XSS bug. Mobile has no
// cookie jar and keeps sending/receiving refreshToken in the body via
// expo-secure-store, so this is additive, not a breaking change to AuthTokens.
const REFRESH_COOKIE_NAME = 'eos_refresh_token';
// Scoped to /api/v1/auth so the browser only ever attaches it to the handful
// of endpoints that actually read it (refresh, logout), not every API call.
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, refreshToken: string): void {
    const isProduction = this.config.get<string>('app.nodeEnv') === 'production';
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      // SameSite=None requires Secure, and only makes sense once the API is
      // actually served over HTTPS -- true in every deployed environment,
      // false for plain-http local dev (where frontend/backend share a site
      // via Vite's dev proxy, so Lax is both sufficient and functional).
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: ms(this.config.get<string>('jwt.refreshExpiresIn') ?? '30d'),
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, req.ip, req.headers['user-agent']);
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return { data: result, error: null };
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for new tokens' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = dto.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) throw new UnauthorizedException('No refresh token provided.');

    const tokens = await this.auth.refresh(refreshToken, req.ip, req.headers['user-agent']);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { data: { tokens }, error: null };
  }

  @Post('logout')
  @AllowPending()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(
    @Body() dto: RefreshTokenDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = dto.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (refreshToken) await this.auth.logout(refreshToken, user.companyId);
    this.clearRefreshCookie(res);
  }

  @Public()
  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation and create account' })
  async acceptInvitation(@Body() dto: AcceptInvitationDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.acceptInvitation(dto);
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return { data: result, error: null };
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('self-signup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create an account directly, using a company-issued signup code' })
  async selfSignup(@Body() dto: SelfSignupDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.selfSignup(dto);
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return { data: result, error: null };
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset password using a reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
  }

  @Get('me')
  @AllowPending()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const me = await this.auth.getMe(user.id, user.companyId);
    return { data: me, error: null };
  }
}