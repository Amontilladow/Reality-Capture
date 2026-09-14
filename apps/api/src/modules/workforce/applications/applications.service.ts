import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import type { CreateApplicationDto } from './dto/create-application.dto';
import type { UpdateApplicationDto } from './dto/update-application.dto';

@Injectable()
export class ApplicationsService {
  constructor(private readonly db: DatabaseService) {}

  async list(companyId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT * FROM application_registry WHERE is_active = true ORDER BY name`);
  }

  async create(companyId: string, userId: string, dto: CreateApplicationDto) {
    const [app] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO application_registry (
        company_id, name, match_pattern, category, discipline,
        productivity_classification, engineering_relevance, created_by
      ) VALUES (
        ${companyId}, ${dto.name}, ${dto.matchPattern}, ${dto.category ?? null}, ${dto.discipline ?? null},
        ${dto.productivityClassification ?? 'unclassified'}, ${dto.engineeringRelevance ?? false}, ${userId}
      ) RETURNING *`);
    return app;
  }

  async update(companyId: string, id: string, dto: UpdateApplicationDto) {
    const [existing] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM application_registry WHERE id = ${id}`);
    if (!existing) throw new NotFoundException({ code: 'APPLICATION_NOT_FOUND', message: 'Application registry entry not found.' });

    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE application_registry SET
        name = COALESCE(${dto.name ?? null}, name),
        category = COALESCE(${dto.category ?? null}, category),
        discipline = COALESCE(${dto.discipline ?? null}, discipline),
        productivity_classification = COALESCE(${dto.productivityClassification ?? null}, productivity_classification),
        engineering_relevance = COALESCE(${dto.engineeringRelevance ?? null}, engineering_relevance),
        is_active = COALESCE(${dto.isActive ?? null}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *`);
    return updated;
  }

  async deactivate(companyId: string, id: string) {
    return this.update(companyId, id, { isActive: false } as UpdateApplicationDto);
  }
}
