import {
  Controller, Post, Body, Get, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AllowPending } from '../../common/decorators/allow-pending.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const result = await this.auth.login(dto, req.ip, req.headers['user-agent']);
    return { data: result, error: null };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for new tokens' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const tokens = await this.auth.refresh(dto, req.ip, req.headers['user-agent']);
    return { data: { tokens }, error: null };
  }

  @Post('logout')
  @AllowPending()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(@Body() dto: RefreshTokenDto, @CurrentUser() user: AuthenticatedUser) {
    await this.auth.logout(dto.refreshToken, user.companyId);
  }

  @Public()
  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation and create account' })
  async acceptInvitation(@Body() dto: AcceptInvitationDto) {
    const result = await this.auth.acceptInvitation(dto);
    return { data: result, error: null };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
  }

  @Public()
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