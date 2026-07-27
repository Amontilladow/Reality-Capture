import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { LinkDocumentDto } from './dto/link-document.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('projects/:projectId/documents')
export class DocumentsController {
  constructor(private readonly svc: DocumentsService) {}

  @Post('upload-url')
  async getUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() body: { filename: string }) {
    return { data: await this.svc.getUploadUrl(u.companyId, pid, body.filename), error: null };
  }

  @Post()
  @ApiOperation({ summary: 'Register a document (internal upload or external reference)' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateDocumentDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  async findAll(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Query() query: PaginationQuery & { docType?: string }) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  @Post(':id/link')
  @ApiOperation({ summary: 'Link a document to a capture, element, location, or issue' })
  async link(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: LinkDocumentDto) {
    return { data: await this.svc.link(u.companyId, id, u.id, dto), error: null };
  }
}