import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScreenshotsService } from './screenshots.service';
import { RecordScreenshotDto } from './dto/record-screenshot.dto';
import { ScreenshotQueryDto } from './dto/screenshot-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/screenshots')
export class ScreenshotsController {
  constructor(private readonly svc: ScreenshotsService) {}

  @Post('upload-url')
  @ApiOperation({ summary: 'Get a presigned URL to upload a screenshot (403 if the company has screenshots disabled)' })
  async getUploadUrl(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getUploadUrl(u.companyId, u.id), error: null };
  }

  @Post()
  @ApiOperation({ summary: 'Record a screenshot after it has been uploaded to the presigned URL' })
  async record(@CurrentUser() u: AuthenticatedUser, @Body() dto: RecordScreenshotDto) {
    return { data: await this.svc.record(u.companyId, u.id, dto), error: null };
  }

  @Get(':userId')
  @ApiOperation({ summary: 'List presigned read URLs for a user\'s screenshots in range (self, downward report, or leadership visibility only)' })
  async listForUser(@CurrentUser() u: AuthenticatedUser, @Param('userId') userId: string, @Query() query: ScreenshotQueryDto) {
    return { data: await this.svc.listForUser(u.companyId, u.id, u.companyRole, userId, query.from, query.to), error: null };
  }
}
