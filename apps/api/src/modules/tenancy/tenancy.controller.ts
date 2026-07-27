import { Controller, Get, Post, Delete, Patch, Body, ConflictException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenancyService } from './tenancy.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DatabaseService } from '../../database/database.service';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('company')
@Controller('company')
export class TenancyController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly db: DatabaseService,
  ) {}

  // TEMPORARY — deployment verification cleanup, removed in the very next commit.
  @Public()
  @Delete('_cleanup-deploy-test')
  async cleanupDeployTest() {
    return this.db.withTransaction(async (sql) => {
      const [company] = await sql`SELECT id FROM companies WHERE slug = 'deploy-test-co'`;
      if (!company) return { data: { deletedCount: 0, tables: [] }, error: null };
      const companyId = company.id as string;

      // Many tables carry a direct (non-cascading) company_id FK for RLS
      // efficiency. Find every one of them from the catalog rather than
      // hand-maintaining a list, and clear them before the company row.
      const referencingTables = await sql<{ tableName: string }[]>`
        SELECT DISTINCT tc.table_name AS "tableName"
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'companies'
          AND kcu.column_name = 'company_id'
          AND tc.table_name != 'companies'
      `;

      const tables: string[] = [];
      for (const { tableName } of referencingTables) {
        await sql`DELETE FROM ${sql(tableName)} WHERE company_id = ${companyId}`;
        tables.push(tableName);
      }

      const deleted = await sql`DELETE FROM companies WHERE id = ${companyId} RETURNING id`;
      return { data: { deletedCount: deleted.length, tables }, error: null };
    });
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new company — creates company_admin user and starts 30-day trial' })
  async register(@Body() dto: RegisterCompanyDto) {
    // Check slug uniqueness before attempting insert
    const existing = await this.tenancy.findBySlug(dto.slug);
    if (existing) throw new ConflictException(`The slug "${dto.slug}" is already taken.`);

    const result = await this.tenancy.register({
      companyName: dto.companyName,
      slug: dto.slug,
      adminEmail: dto.adminEmail,
      adminFirstName: dto.adminFirstName,
      adminLastName: dto.adminLastName,
      adminPassword: dto.adminPassword,
    });

    return { data: { company: result.company, user: result.user }, error: null };
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current company details and subscription' })
  async getCompany(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.tenancy.findById(u.companyId), error: null };
  }

  @Patch('settings')
  @ApiBearerAuth()
  @Roles('company_admin')
  @ApiOperation({ summary: 'Update company settings' })
  async updateSettings(@CurrentUser() u: AuthenticatedUser, @Body() settings: Record<string, unknown>) {
    return { data: await this.tenancy.updateSettings(u.companyId, settings), error: null };
  }
}
