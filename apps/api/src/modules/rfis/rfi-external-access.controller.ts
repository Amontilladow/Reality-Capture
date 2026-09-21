import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RfiExternalAccessService } from './rfi-external-access.service';
import { GenerateExternalAccessDto } from './dto/generate-external-access.dto';
import { RespondToRfiDto } from './dto/respond-to-rfi.dto';
import { DecideReviewDto } from './dto/decide-review.dto';
import { ExternalCommentDto } from './dto/external-comment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

// ── Internal, authenticated side ──────────────────────────────────────────
// Nested under the same projects/:projectId/rfis/:id prefix RfisController
// uses, gated the same way as respond/close/reopen -- generating a link
// that can answer or close an RFI is exactly that sensitive.
@ApiTags('rfis')
@ApiBearerAuth()
@Controller('projects/:projectId/rfis/:id/external-access')
export class RfiExternalAccessController {
  constructor(private readonly svc: RfiExternalAccessService) {}

  @Post()
  @RequireProjectPermission('manage_rfis')
  @ApiOperation({ summary: 'Generate an external access link for a stakeholder with no EngineeringOS account' })
  async generate(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: GenerateExternalAccessDto,
  ) {
    return { data: await this.svc.generate(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Get()
  @RequireProjectPermission('manage_rfis')
  @ApiOperation({ summary: 'List external access links generated for this RFI' })
  async list(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.list(u.companyId, pid, id), error: null };
  }

  @Delete(':accessId')
  @RequireProjectPermission('manage_rfis')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an external access link immediately' })
  async revoke(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Param('accessId') accessId: string,
  ) {
    return { data: await this.svc.revoke(u.companyId, pid, id, accessId, u.id), error: null };
  }
}

// ── Public, unauthenticated side ──────────────────────────────────────────
// Prefixed distinctly (public/rfis/external/:token/...) from every
// @RequireProjectPermission-guarded RFI route above so there's no risk of a
// routing collision. Every route here is @Public() -- see JwtAuthGuard,
// which skips the bearer-token check entirely for these. The token itself
// is the only credential; there is no request.user on any of these routes.
@ApiTags('rfis')
@Controller('public/rfis/external/:token')
export class RfiExternalAccessPublicController {
  constructor(private readonly svc: RfiExternalAccessService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "An external stakeholder's narrow view of the one RFI their link was issued for" })
  async getByToken(@Param('token') token: string) {
    return { data: await this.svc.getByToken(token), error: null };
  }

  @Public()
  @Post('respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Submit the formal response to an RFI via a 'respond'-action external link" })
  async respond(@Param('token') token: string, @Body() dto: RespondToRfiDto) {
    return { data: await this.svc.respondExternal(token, dto), error: null };
  }

  @Public()
  @Post('review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Approve or reject a response via a 'review'-action external link" })
  async review(@Param('token') token: string, @Body() dto: DecideReviewDto) {
    return { data: await this.svc.reviewExternal(token, dto), error: null };
  }

  @Public()
  @Post('comments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a comment via any external link, whatever action it authorizes' })
  async comment(@Param('token') token: string, @Body() dto: ExternalCommentDto) {
    return { data: await this.svc.commentExternal(token, dto), error: null };
  }
}
