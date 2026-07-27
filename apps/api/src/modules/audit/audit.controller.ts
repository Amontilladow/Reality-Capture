import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DatabaseService } from '../../database/database.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('company_admin', 'technical_director')
  @RequireFeature('auditExport')
  @ApiOperation({ summary: 'List audit log entries for the company' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('perPage') perPage = 50,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const offset = (page - 1) * perPage;
    const rows = await this.db.query`
      SELECT *, COUNT(*) OVER() AS full_count
      FROM audit_log
      WHERE company_id = ${user.companyId}
        AND (${action ?? null} IS NULL OR action = ${action ?? null})
        AND (${resourceType ?? null} IS NULL OR resource_type = ${resourceType ?? null})
        AND (${from ?? null} IS NULL OR occurred_at >= ${from ?? null}::timestamptz)
        AND (${to ?? null} IS NULL OR occurred_at <= ${to ?? null}::timestamptz)
      ORDER BY occurred_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;
    return { data: rows, meta: { page, perPage }, error: null };
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Audit log for a specific project' })
  async forProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('page') page = 1,
    @Query('perPage') perPage = 50,
  ) {
    const offset = (page - 1) * perPage;
    const rows = await this.db.query`
      SELECT *, COUNT(*) OVER() AS full_count
      FROM audit_log
      WHERE company_id = ${user.companyId} AND project_id = ${projectId}
      ORDER BY occurred_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;
    return { data: rows, meta: { page, perPage }, error: null };
  }
}