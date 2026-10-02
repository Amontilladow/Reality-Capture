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

    // No RLS tenant context is (or should be) set yet at this point in the
    // guard chain -- this check runs on every request, before any handler's
    // own withTenant() call. Under migration 052's FORCE ROW LEVEL SECURITY,
    // a plain this.db.query here would see zero rows unconditionally (same
    // bootstrap category as auth.service.ts's login()), falsely throwing
    // TenantNotFoundException for every authenticated request. withSystemBypass
    // is correct here precisely because this check's whole job is verifying
    // the company itself, independent of any tenant-scoped row.
    const [company] = await this.db.withSystemBypass(sql => sql`
      SELECT id FROM companies WHERE id = ${companyId} AND is_active = true
    `);
    if (!company) throw new TenantNotFoundException();

    // Attach to request for downstream use
    request.companyId = companyId;
    return true;
  }
}