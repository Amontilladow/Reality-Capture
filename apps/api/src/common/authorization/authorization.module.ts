import { Global, Module } from '@nestjs/common';
import { ProjectAuthorizationService } from './project-authorization.service';

// Global, same as DatabaseModule -- ProjectAuthorizationService is consumed
// by ProjectPermissionGuard (app-wide, via APP_GUARD) and by individual
// module services (RfisService, IssuesService, ...) that need the same
// project-role/permission check for logic a route guard alone can't express
// (e.g. "the RFI's own creator may act on it even with no grant").
@Global()
@Module({
  providers: [ProjectAuthorizationService],
  exports: [ProjectAuthorizationService],
})
export class AuthorizationModule {}
