import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { TenantNotFoundException } from '../exceptions/tenant-not-found.exception';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';

@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const companyId: string | undefined = request.user?.companyId;
    if (!companyId) return false;

    // Verify the company exists and is active — single lightweight query
    const [company] = await this.db.query`
      SELECT id FROM companies WHERE id = ${companyId} AND is_active = true
    `;
    if (!company) throw new TenantNotFoundException();

    // Attach to request for downstream use
    request.companyId = companyId;
    return true;
  }
}