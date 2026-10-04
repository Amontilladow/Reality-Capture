import { Injectable } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { CapturesService } from '../captures/captures.service';
import { IssuesService } from '../issues/issues.service';
import { ProgressReportsService } from '../progress-reports/progress-reports.service';
import type { PaginationQuery } from '@engineeringos/types';

const DEFAULT_PROGRESS_WINDOW_DAYS = 30;

// Thin read-only wrappers around the same services the authenticated app
// uses -- every call still goes through companyId-scoped withTenant() calls
// inside those services, so a projectId belonging to another tenant
// resolves to an empty/not-found result here exactly as it would for a
// JWT-authenticated request from the wrong company, never a cross-tenant
// leak. No separate "does this project belong to this company" check is
// needed on top of that.
@Injectable()
export class PublicApiService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly captures: CapturesService,
    private readonly issues: IssuesService,
    private readonly progressReports: ProgressReportsService,
  ) {}

  async listProjects(companyId: string, query: PaginationQuery) {
    return this.projects.findAll(companyId, query);
  }

  async listCaptures(companyId: string, projectId: string, query: PaginationQuery) {
    return this.captures.findAll(companyId, projectId, query);
  }

  async listIssues(companyId: string, projectId: string, query: PaginationQuery) {
    return this.issues.findAll(companyId, projectId, query);
  }

  async getProgress(companyId: string, projectId: string, dateFrom?: string, dateTo?: string) {
    const to = dateTo ?? new Date().toISOString();
    const from = dateFrom ?? new Date(Date.now() - DEFAULT_PROGRESS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    return this.progressReports.generate(companyId, projectId, { dateFrom: from, dateTo: to });
  }
}
