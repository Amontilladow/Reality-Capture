import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SharePointIntegrationService } from './sharepoint-integration.service';
import { ConnectSharePointDto } from './dto/connect-sharepoint.dto';
import { MapSharePointProjectSiteDto } from './dto/map-sharepoint-project-site.dto';

// Company-wide (not per-project) SharePoint connection admin -- gated by
// CompanyRole via RolesGuard, same mechanism ApiKeysController uses for
// the same reason (this configures how EVERY project in the company can
// reach SharePoint, not something a single project's own members should
// self-service).
@ApiTags('site-drawings')
@ApiBearerAuth()
@Controller('site-drawings/sharepoint-integration')
@Roles('company_admin')
export class SharePointIntegrationController {
  constructor(private readonly svc: SharePointIntegrationService) {}

  @Get()
  @ApiOperation({ summary: "This company's SharePoint connection status and project site mappings" })
  async getStatus(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getStatus(u.companyId), error: null };
  }

  @Put()
  @ApiOperation({ summary: 'Connect (or reconnect) SharePoint for this company, validating the tenant ID first' })
  async connect(@CurrentUser() u: AuthenticatedUser, @Body() dto: ConnectSharePointDto) {
    return { data: await this.svc.connect(u.companyId, dto), error: null };
  }

  @Delete()
  @ApiOperation({ summary: 'Disconnect SharePoint for this company (project site mappings are kept, not deleted)' })
  async disconnect(@CurrentUser() u: AuthenticatedUser) {
    await this.svc.disconnect(u.companyId);
    return { data: { disconnected: true }, error: null };
  }

  @Put('projects/:projectId')
  @ApiOperation({ summary: 'Map a project onto a SharePoint site + document library, validating reachability first' })
  async mapProjectSite(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') projectId: string, @Body() dto: MapSharePointProjectSiteDto,
  ) {
    return { data: await this.svc.mapProjectSite(u.companyId, projectId, dto), error: null };
  }

  @Delete('projects/:projectId')
  @ApiOperation({ summary: 'Remove a project\'s SharePoint site mapping' })
  async unmapProjectSite(@CurrentUser() u: AuthenticatedUser, @Param('projectId') projectId: string) {
    await this.svc.unmapProjectSite(u.companyId, projectId);
    return { data: { removed: true }, error: null };
  }
}
