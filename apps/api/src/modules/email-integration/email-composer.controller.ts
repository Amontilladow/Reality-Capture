import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmailComposerService } from './email-composer.service';
import { SendEmailDto } from './dto/send-email.dto';
import { EmailAttachmentUploadUrlDto } from './dto/email-attachment-upload-url.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('email-messages')
@ApiBearerAuth()
@Controller('projects/:projectId/emails')
export class EmailComposerController {
  constructor(private readonly svc: EmailComposerService) {}

  @Post('attachments/upload-url')
  @ApiOperation({ summary: 'Get a presigned URL to upload an email attachment before sending' })
  async getAttachmentUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: EmailAttachmentUploadUrlDto) {
    return { data: await this.svc.getAttachmentUploadUrl(u.companyId, pid, u.id, u.companyRole, dto), error: null };
  }

  @Post()
  @ApiOperation({ summary: 'Send an email from the current user\'s connected mailbox, on behalf of this project' })
  async send(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: SendEmailDto) {
    return { data: await this.svc.send(u.companyId, u.id, u.companyRole, pid, dto), error: null };
  }
}
