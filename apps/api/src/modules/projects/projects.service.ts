import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PaymentRequiredException } from '../../common/exceptions/payment-required.exception';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import type { AddMemberDto } from './dto/add-member.dto';
import type { PaginationQuery } from '@engineeringos/types';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly subscription: SubscriptionService,
  ) {}

  async findAll(companyId: string, query: PaginationQuery) {
    const page = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset = (page - 1) * perPage;
    const search = query.search ? `%${query.search}%` : null;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        p.id, p.name, p.code, p.description, p.location, p.country, p.city,
        p.status, p.start_date, p.expected_end_date, p.cover_image_url,
        p.created_at, p.updated_at,
        COUNT(DISTINCT pm.user_id) AS member_count,
        COUNT(DISTINCT c.id)       AS capture_count,
        COUNT(DISTINCT i.id) FILTER (WHERE i.status != 'closed') AS open_issue_count,
        COUNT(*) OVER() AS full_count
      FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id
      LEFT JOIN captures c ON c.project_id = p.id
      LEFT JOIN issues i ON i.project_id = p.id
      WHERE p.company_id = ${companyId}
        AND p.status != 'archived'
        AND (${search}::text IS NULL OR LOWER(p.name) LIKE LOWER(${search}) OR LOWER(p.code) LIKE LOWER(${search}))
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async findOne(companyId: string, projectId: string) {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT p.*,
        COUNT(DISTINCT pm.user_id) AS member_count,
        COUNT(DISTINCT c.id)       AS capture_count,
        COUNT(DISTINCT i.id) FILTER (WHERE i.status NOT IN ('closed','void')) AS open_issue_count
      FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id
      LEFT JOIN captures c ON c.project_id = p.id
      LEFT JOIN issues i ON i.project_id = p.id
      WHERE p.id = ${projectId} AND p.company_id = ${companyId}
      GROUP BY p.id
    `);

    if (!project) throw new NotFoundException(`Project ${projectId} not found.`);
    return project;
  }

  async create(companyId: string, userId: string, dto: CreateProjectDto) {
    const limitCheck = await this.subscription.checkLimit(companyId, 'projects');
    if (!limitCheck.allowed) {
      throw new PaymentRequiredException('projects', limitCheck.reason);
    }

    const [project] = await this.db.query`
      INSERT INTO projects (
        company_id, name, code, description, location, country, city,
        start_date, expected_end_date, created_by
      ) VALUES (
        ${companyId}, ${dto.name}, ${dto.code ?? null}, ${dto.description ?? null},
        ${dto.location ?? null}, ${dto.country ?? null}, ${dto.city ?? null},
        ${dto.startDate ?? null}, ${dto.expectedEndDate ?? null}, ${userId}
      )
      RETURNING *
    `;

    // Auto-add creator as project_lead
    await this.db.query`
      INSERT INTO project_members (project_id, user_id, company_id, role, invited_by)
      VALUES (${project.id}, ${userId}, ${companyId}, 'project_lead', ${userId})
    `;

    return project;
  }

  async update(companyId: string, projectId: string, dto: UpdateProjectDto) {
    await this.findOne(companyId, projectId);

    const [updated] = await this.db.query`
      UPDATE projects SET
        name              = COALESCE(${dto.name ?? null}, name),
        code              = COALESCE(${dto.code ?? null}, code),
        description       = COALESCE(${dto.description ?? null}, description),
        location          = COALESCE(${dto.location ?? null}, location),
        country           = COALESCE(${dto.country ?? null}, country),
        city              = COALESCE(${dto.city ?? null}, city),
        status            = COALESCE(${dto.status ?? null}, status),
        start_date        = COALESCE(${dto.startDate ?? null}, start_date),
        expected_end_date = COALESCE(${dto.expectedEndDate ?? null}, expected_end_date),
        updated_at        = NOW()
      WHERE id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `;

    return updated;
  }

  async getMembers(companyId: string, projectId: string) {
    await this.findOne(companyId, projectId);
    return this.db.withTenant(companyId, sql => sql`
      SELECT pm.id, pm.role, pm.joined_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             u.company_role, u.avatar_url
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ${projectId}
      ORDER BY u.first_name, u.last_name
    `);
  }

  async addMember(companyId: string, projectId: string, invitedBy: string, dto: AddMemberDto) {
    await this.findOne(companyId, projectId);
    const [member] = await this.db.query`
      INSERT INTO project_members (project_id, user_id, company_id, role, invited_by)
      VALUES (${projectId}, ${dto.userId}, ${companyId}, ${dto.role}, ${invitedBy})
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = ${dto.role}
      RETURNING *
    `;
    return member;
  }

  async removeMember(companyId: string, projectId: string, userId: string) {
    await this.db.query`
      DELETE FROM project_members
      WHERE project_id = ${projectId} AND user_id = ${userId} AND company_id = ${companyId}
    `;
    return { message: 'Member removed from project.' };
  }

  // ── Building/Level/Location helpers (full CRUD in buildings.module) ─────────
  async getHierarchy(companyId: string, projectId: string) {
    const buildings = await this.db.withTenant(companyId, sql => sql`
      SELECT b.id, b.name, b.code, b.total_levels,
        COALESCE(
          json_agg(
            json_build_object(
              'id', l.id, 'name', l.name, 'levelOrder', l.level_order,
              'elevationM', l.elevation_m,
              'locations', COALESCE(loc.locations, '[]'::json)
            ) ORDER BY l.level_order
          ) FILTER (WHERE l.id IS NOT NULL),
          '[]'::json
        ) AS levels
      FROM buildings b
      LEFT JOIN levels l ON l.building_id = b.id
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', loc.id, 'name', loc.name, 'description', loc.description,
            'captureCount', (SELECT COUNT(*) FROM captures c WHERE c.location_id = loc.id)
          ) ORDER BY loc.name
        ) AS locations
        FROM locations loc
        WHERE loc.level_id = l.id
      ) loc ON true
      WHERE b.project_id = ${projectId}
      GROUP BY b.id
      ORDER BY b.name
    `);
    return buildings;
  }
}