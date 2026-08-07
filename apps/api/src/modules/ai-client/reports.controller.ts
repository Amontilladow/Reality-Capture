import { Controller, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiClientService } from './ai-client.service';
import { GenerateReportDto } from './dto/generate-report.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('projects/:projectId/reports')
export class ReportsController {
  constructor(private readonly aiClient: AiClientService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate an AI-narrated report for this project' })
  async generate(@CurrentUser() u: AuthenticatedUser, @Param('projectId') projectId: string, @Body() dto: GenerateReportDto) {
    try {
      // company_id always comes from the authenticated session, never the
      // client, same reasoning as the assistant endpoint -- the AI service
      // scopes its queries by whatever it's given.
      const result = await this.aiClient.generateReport(u.companyId, projectId, dto.reportType, dto.dateFrom, dto.dateTo);
      return { data: result, error: null };
    } catch (err) {
      throw new HttpException(
        { data: null, error: { code: 'AI_SERVICE_UNAVAILABLE', message: 'Report generation is temporarily unavailable. Please try again shortly.' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
