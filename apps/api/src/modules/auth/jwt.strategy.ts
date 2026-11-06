import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload, AuthenticatedUser } from '@engineeringos/types';
import { SessionRevocationService } from './session-revocation.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly sessionRevocation: SessionRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
    });
  }

  // Called by Passport after signature is verified
  // Return value is attached to request.user
  //
  // M-1 fix: this previously did no lookup beyond the signature/expiry
  // check Passport itself performs, so a deactivated user's pre-existing
  // access token stayed valid for its full remaining lifetime despite
  // UsersService.deactivate()'s own response claiming "all sessions
  // revoked." The deny-list check below is a single cheap Redis read, not
  // a DB round trip, so it doesn't add real latency to the hot path.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.companyId) {
      throw new UnauthorizedException('Invalid token payload.');
    }
    if (await this.sessionRevocation.isDenied(payload.sub)) {
      throw new UnauthorizedException('This account has been deactivated.');
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