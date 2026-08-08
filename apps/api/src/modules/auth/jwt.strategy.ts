import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload, AuthenticatedUser } from '@engineeringos/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
    });
  }

  // Called by Passport after signature is verified
  // Return value is attached to request.user
  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload.sub || !payload.companyId) {
      throw new UnauthorizedException('Invalid token payload.');
    }
    return {
      id: payload.sub,
      email: payload.email,
      companyId: payload.companyId,
      companyRole: payload.companyRole,
      firstName: payload.firstName ?? '',
      lastName: payload.lastName ?? '',
      pendingApproval: payload.pendingApproval ?? false,
    };
  }
}