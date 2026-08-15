import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { StorageService } from '../storage/storage.service';
import { PaymentRequiredException } from '../../common/exceptions/payment-required.exception';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import type { AddMemberDto } from './dto/add-member.dto';
import type { CreatePermissionGrantDto } from './dto/create-permission-grant.dto';
import type { UpsertOrganizationDto } from './dto/upsert-organization.dto';
import type { PaginationQuery, ProjectPermission, ProjectOrganizationSlot } from '@engineeringos/types';
import { PROJECT_ORGANIZATION_SLOTS } from '@engineeringos/types';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly subscription: SubscriptionService,
    private readonly storage: StorageService,
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

    // Resolve branding storage keys to live presigned read URLs at read
    // time -- never persist a URL that can expire, same convention as
    // every other file reference in this codebase.
    const urls = await this.storage.resolveUrls([project.logoStorageKey as string, project.stampStorageKey as string]);
    return {
      ...project,
      logoUrl: project.logoStorageKey ? urls.get(project.logoStorageKey as string) : undefined,
      stampUrl: project.stampStorageKey ? urls.get(project.stampStorageKey as string) : undefined,
    };
  }

  async create(companyId: string, userId: string, dto: CreateProjectDto) {
    const limitCheck = await this.subscription.checkLimit(companyId, 'projects');
    if (!limitCheck.allowed) {
      throw new PaymentRequiredException('projects', limitCheck.reason);
    }

    // withTenant required -- projects and project_members both carry the tenant_isolation
    // RLS policy. A plain this.db.query() never sets app.current_company_id, so under any DB
    // role that isn't the table owner/a superuser the implicit WITH CHECK (mirroring USING,
    // since neither table declares a separate one) rejects both inserts outright with
    // "new row violates row-level security policy".
    return this.db.withTenant(companyId, async (sql) => {
      const [project] = await sql`
        INSERT INTO projects (
          company_id, name, code, description, location, country, city,
          start_date, expected_end_date, created_by,
          org_code, client_name, lead_designer, consultant_name,
          technical_advisor, pmc_name, main_contractor, subcontractor
        ) VALUES (
          ${companyId}, ${dto.name}, ${dto.code ?? null}, ${dto.description ?? null},
          ${dto.location ?? null}, ${dto.country ?? null}, ${dto.city ?? null},
          ${dto.startDate ?? null}, ${dto.expectedEndDate ?? null}, ${userId},
          ${dto.orgCode ?? null}, ${dto.clientName ?? null}, ${dto.leadDesigner ?? null}, ${dto.consultantName ?? null},
          ${dto.technicalAdvisor ?? null}, ${dto.pmcName ?? null}, ${dto.mainContractor ?? null}, ${dto.subcontractor ?? null}
        )
        RETURNING *
      `;

      // Auto-add creator as project_lead
      await sql`
        INSERT INTO project_members (project_id, user_id, company_id, role, invited_by)
        VALUES (${project.id}, ${userId}, ${companyId}, 'project_lead', ${userId})
      `;

      return project;
    });
  }

  async update(companyId: string, projectId: string, dto: UpdateProjectDto) {
    await this.findOne(companyId, projectId);

    // withTenant required -- see create() above.
    const [updated] = await this.db.withTenant(companyId, sql => sql`
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
        phase             = COALESCE(${dto.phase ?? null}, phase),
        org_code          = COALESCE(${dto.orgCode ?? null}, org_code),
        client_name       = COALESCE(${dto.clientName ?? null}, client_name),
        lead_designer     = COALESCE(${dto.leadDesigner ?? null}, lead_designer),
        consultant_name   = COALESCE(${dto.consultantName ?? null}, consultant_name),
        technical_advisor = COALESCE(${dto.technicalAdvisor ?? null}, technical_advisor),
        pmc_name          = COALESCE(${dto.pmcName ?? null}, pmc_name),
        main_contractor   = COALESCE(${dto.mainContractor ?? null}, main_contractor),
        subcontractor     = COALESCE(${dto.subcontractor ?? null}, subcontractor),
        logo_storage_key  = COALESCE(${dto.logoStorageKey ?? null}, logo_storage_key),
        stamp_storage_key = COALESCE(${dto.stampStorageKey ?? null}, stamp_storage_key),
        updated_at        = NOW()
      WHERE id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `);

    // Resolve immediately so the frontend can show the new thumbnail
    // without a second round trip -- same as findOne() above.
    const urls = await this.storage.resolveUrls([updated.logoStorageKey as string, updated.stampStorageKey as string]);
    return {
      ...updated,
      logoUrl: updated.logoStorageKey ? urls.get(updated.logoStorageKey as string) : undefined,
      stampUrl: updated.stampStorageKey ? urls.get(updated.stampStorageKey as string) : undefined,
    };
  }

  // Presigned upload URL for a project's logo/stamp image -- client PUTs the
  // file directly to storage, then PATCHes the project with the resulting
  // storageKey (reusing the same update() path every other project field
  // uses), no separate "register" endpoint needed.
  async getBrandingUploadUrl(companyId: string, projectId: string, filename: string, sizeBytes: number, kind: 'logo' | 'stamp') {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!['jpg', 'jpeg', 'png'].includes(ext)) {
      throw new BadRequestException(`Logo/stamp images must be JPG or PNG (got ".${ext}").`);
    }
    const maxSize = 2 * 1024 * 1024; // 2 MB -- these are small letterhead/seal images, not photos
    if (sizeBytes > maxSize) {
      throw new BadRequestException(`Image too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Max: ${maxSize / 1024 / 1024} MB.`);
    }
    const key = this.storage.generateKey(companyId, projectId, 'branding', `${kind}-${filename}`);
    const { uploadUrl } = await this.storage.getUploadUrl(key, 'application/octet-stream', sizeBytes);
    return { uploadUrl, storageKey: key };
  }

  // ── Project organizations (Phase 4) ─────────────────────────────────────
  // 5 fixed stakeholder slots per project (client/pmc/ldc/main_contractor/
  // subcontractor) -- see PROJECT_ORGANIZATION_SLOTS. Rows only exist once
  // someone has configured that slot; unconfigured slots are simply absent
  // from this list (not padded with empty placeholders -- the caller, e.g.
  // RfiDetailPage's OrganizationSlotRow, renders its own placeholder for a
  // slot with no matching row).
  private assertValidSlot(slot: string): asserts slot is ProjectOrganizationSlot {
    if (!(PROJECT_ORGANIZATION_SLOTS as readonly string[]).includes(slot)) {
      throw new BadRequestException(`Invalid organization slot '${slot}'. Must be one of: ${PROJECT_ORGANIZATION_SLOTS.join(', ')}.`);
    }
  }

  async getOrganizations(companyId: string, projectId: string) {
    await this.findOne(companyId, projectId);
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT * FROM project_organizations
      WHERE project_id = ${projectId} AND company_id = ${companyId}
      ORDER BY slot
    `);
    // Resolve storage keys to live presigned read URLs at read time --
    // never persist a URL that can expire, same convention as everywhere
    // else in this codebase (see getAttachments() in rfis.service.ts).
    const urls = await this.storage.resolveUrls(rows.map(r => r.logoStorageKey as string));
    return rows.map(r => ({ ...r, logoUrl: r.logoStorageKey ? urls.get(r.logoStorageKey as string) : undefined }));
  }

  async upsertOrganization(companyId: string, projectId: string, slot: string, dto: UpsertOrganizationDto) {
    this.assertValidSlot(slot);
    await this.findOne(companyId, projectId);

    const [row] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO project_organizations (project_id, company_id, slot, name, org_ref, contact_name, contact_email, logo_storage_key)
      VALUES (${projectId}, ${companyId}, ${slot}, ${dto.name ?? null}, ${dto.orgRef ?? null}, ${dto.contactName ?? null}, ${dto.contactEmail ?? null}, ${dto.logoStorageKey ?? null})
      ON CONFLICT (project_id, slot) DO UPDATE SET
        name             = COALESCE(${dto.name ?? null}, project_organizations.name),
        org_ref          = COALESCE(${dto.orgRef ?? null}, project_organizations.org_ref),
        contact_name     = COALESCE(${dto.contactName ?? null}, project_organizations.contact_name),
        contact_email    = COALESCE(${dto.contactEmail ?? null}, project_organizations.contact_email),
        logo_storage_key = COALESCE(${dto.logoStorageKey ?? null}, project_organizations.logo_storage_key),
        updated_at       = NOW()
      RETURNING *
    `);

    const urls = await this.storage.resolveUrls([row.logoStorageKey as string]);
    return { ...row, logoUrl: row.logoStorageKey ? urls.get(row.logoStorageKey as string) : undefined };
  }

  // Mirrors getBrandingUploadUrl() exactly (jpg/jpeg/png only, 2MB max) --
  // these are the same kind of small letterhead-style logo image, sharing
  // the generic 'branding' storage-key type rather than a new one.
  async getOrganizationLogoUploadUrl(companyId: string, projectId: string, slot: string, filename: string, sizeBytes: number) {
    this.assertValidSlot(slot);
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!['jpg', 'jpeg', 'png'].includes(ext)) {
      throw new BadRequestException(`Logo images must be JPG or PNG (got ".${ext}").`);
    }
    const maxSize = 2 * 1024 * 1024; // 2 MB -- same cap as project branding
    if (sizeBytes > maxSize) {
      throw new BadRequestException(`Image too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Max: ${maxSize / 1024 / 1024} MB.`);
    }
    const key = this.storage.generateKey(companyId, projectId, 'branding', `org-${slot}-${filename}`);
    const { uploadUrl } = await this.storage.getUploadUrl(key, 'application/octet-stream', sizeBytes);
    return { uploadUrl, storageKey: key };
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
    // Must go through withTenant -- project_members has a tenant_isolation RLS
    // policy keyed on app.current_company_id. A plain this.db.query() never sets
    // that, so under any DB role that isn't the table owner/a superuser, the
    // implicit WITH CHECK (mirroring the USING clause, since none is declared)
    // rejects the insert outright with "new row violates row-level security policy".
    const [member] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO project_members (project_id, user_id, company_id, role, invited_by)
      VALUES (${projectId}, ${dto.userId}, ${companyId}, ${dto.role}, ${invitedBy})
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = ${dto.role}
      RETURNING *
    `);
    return member;
  }

  async removeMember(companyId: string, projectId: string, userId: string) {
    // Same withTenant requirement as addMember() above -- without it, the
    // DELETE's WHERE-matched rows are invisible under RLS (company_id compared
    // against a NULL current_company_id), so it silently deletes 0 rows instead
    // of erroring. Checking result.count turns that into a real 404 instead of
    // a false "success" that leaves the member still sitting in the list.
    const result = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM project_members
      WHERE project_id = ${projectId} AND user_id = ${userId} AND company_id = ${companyId}
    `);
    if (result.count === 0) {
      throw new NotFoundException('That person is not a member of this project.');
    }
    return { message: 'Member removed from project.' };
  }

  // ── Per-project permission grants ────────────────────────────────────────
  // super_admin has full authority everywhere and project_lead has it on
  // their own project by default (see ProjectPermissionGuard) -- these
  // grants exist purely to extend a specific company_admin's reach to a
  // specific project without making it company-wide or permanent.
  async getPermissionGrants(companyId: string, projectId: string) {
    await this.findOne(companyId, projectId);
    return this.db.withTenant(companyId, sql => sql`
      SELECT g.id, g.permission, g.granted_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             gb.first_name AS granted_by_first_name, gb.last_name AS granted_by_last_name
      FROM project_permission_grants g
      JOIN users u ON u.id = g.user_id
      JOIN users gb ON gb.id = g.granted_by
      WHERE g.project_id = ${projectId}
      ORDER BY u.first_name, u.last_name, g.permission
    `);
  }

  async grantPermission(companyId: string, projectId: string, grantedBy: string, dto: CreatePermissionGrantDto) {
    await this.findOne(companyId, projectId);

    // Grants exist to extend company_admin's reach -- anyone else either
    // already has full authority (super_admin) or gets it a different way
    // (project_lead on their own project), so granting to any other role
    // would be meaningless or a way to route around the role system.
    const [target] = await this.db.withTenant(companyId, sql => sql`
      SELECT company_role, is_active, requested_company_role FROM users WHERE id = ${dto.userId}
    `);
    if (!target) throw new NotFoundException('User not found.');
    if (target.companyRole !== 'company_admin') {
      throw new BadRequestException('Permission grants can only be given to a company_admin.');
    }
    if (!target.isActive) {
      throw new BadRequestException('Cannot grant a permission to a deactivated account.');
    }
    if (target.requestedCompanyRole) {
      throw new BadRequestException('This account is still awaiting approval and cannot be granted permissions yet.');
    }

    const [grant] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO project_permission_grants (project_id, user_id, company_id, permission, granted_by)
      VALUES (${projectId}, ${dto.userId}, ${companyId}, ${dto.permission}, ${grantedBy})
      ON CONFLICT (project_id, user_id, permission) DO NOTHING
      RETURNING id, permission, granted_at
    `);
    return grant ?? { message: 'That permission was already granted.' };
  }

  async revokePermission(companyId: string, projectId: string, userId: string, permission: ProjectPermission) {
    const result = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM project_permission_grants
      WHERE project_id = ${projectId} AND user_id = ${userId} AND permission = ${permission}
    `);
    if (result.count === 0) {
      throw new NotFoundException('That permission grant does not exist.');
    }
    return { message: 'Permission revoked.' };
  }

  // ── Building/Level/Location helpers (full CRUD in buildings.module) ─────────
  async getHierarchy(companyId: string, projectId: string) {
    const buildings = await this.db.withTenant(companyId, sql => sql`
      SELECT b.id, b.name, b.code, b.total_levels, b.phase,
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
        WHERE loc.level_id = l.id AND loc.archived_at IS NULL
      ) loc ON true
      WHERE b.project_id = ${projectId}
      GROUP BY b.id
      ORDER BY b.name
    `);
    return buildings;
  }
}