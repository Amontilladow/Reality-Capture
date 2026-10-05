import { Injectable, Logger } from '@nestjs/common';
import {
  ISSUE_DISCIPLINE_TO_RISK_DISCIPLINE,
  RFI_DISCIPLINE_TO_RISK_DISCIPLINE,
  RISK_DISCIPLINES,
  type IssueDiscipline,
  type RfiDiscipline,
  type RiskDiscipline,
} from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { RiskGraphService } from './risk-graph.service';

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'has', 'will', 'are', 'was', 'not']);

export function titleWords(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase().match(/[a-z0-9]+/g)?.filter(w => w.length > 3 && !STOPWORDS.has(w)) ?? [],
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Submittals.discipline is free-text (no fixed vocabulary, unlike RFIs/
// Issues), so there's no lookup table to translate it the way
// RFI_DISCIPLINE_TO_RISK_DISCIPLINE/ISSUE_DISCIPLINE_TO_RISK_DISCIPLINE do.
// Rather than inventing a classification for arbitrary free text, this only
// recognizes an exact (case-insensitive) match against the canonical
// RiskDiscipline vocabulary itself -- a real, very common way for someone to
// type "Structural" or "MEP" -- and leaves anything else unclassified
// (null) rather than guessing.
export function canonicalizeFreeTextDiscipline(value: string | null | undefined): RiskDiscipline | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (RISK_DISCIPLINES as readonly string[]).includes(normalized) ? (normalized as RiskDiscipline) : null;
}

export const RFI_ISSUE_MAX_DAY_GAP = 14;

/**
 * Pure decision function for whether/how confidently an RFI and an Issue
 * should be linked by inference (brief section 6 — every inferred
 * relationship must be explainable and never presented as fact). Returns
 * null when the two entities should NOT be linked at all (different
 * canonical discipline, or too far apart in time) -- this is the "no
 * fabricated relationship" guarantee (Scenario G), kept as a standalone
 * function so it can be unit-tested without a database.
 */
export function computeInferredRfiIssueConfidence(
  rfiCanonicalDiscipline: string, issueCanonicalDiscipline: string, dayGap: number,
  rfiSubject: string, issueTitle: string,
): number | null {
  if (rfiCanonicalDiscipline !== issueCanonicalDiscipline) return null;
  if (dayGap > RFI_ISSUE_MAX_DAY_GAP) return null;

  const similarity = jaccard(titleWords(rfiSubject), titleWords(issueTitle));
  const timeProximityScore = 1 - dayGap / RFI_ISSUE_MAX_DAY_GAP;
  return Math.min(0.9, 0.35 + timeProximityScore * 0.25 + similarity * 0.3);
}

/**
 * Builds the Project Risk Graph (migration 050) from the real, existing
 * domain tables. This is pure read-then-upsert: it never writes to rfis,
 * issues, snag_items, or any other domain table, and every explicit edge
 * it creates mirrors a foreign key that already exists in that table's own
 * schema (see the architecture assessment for exactly which FKs exist on
 * which table -- notably: RFIs have none, so every RFI relationship beyond
 * ASSIGNED_TO/OWNED_BY is RULE_INFERENCE, never EXPLICIT).
 *
 * Each extractX method is idempotent (upsert-based) and safe to call
 * either for a whole project (initial build, or a manual "Refresh
 * analysis") or for one entity id (event-driven incremental recalculation,
 * brief section 41).
 */
@Injectable()
export class RelationshipExtractionService {
  private readonly logger = new Logger(RelationshipExtractionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly graph: RiskGraphService,
  ) {}

  async extractProject(companyId: string, projectId: string): Promise<void> {
    await this.extractLocationHierarchy(companyId, projectId);
    await this.extractBimElements(companyId, projectId);
    await this.extractDrawings(companyId, projectId);
    await this.extractRfis(companyId, projectId);
    await this.extractIssues(companyId, projectId);
    await this.extractSnagItems(companyId, projectId);
    await this.extractQaInspections(companyId, projectId);
    await this.extractSubmittals(companyId, projectId);
    await this.extractInferredRfiIssueLinks(companyId, projectId);
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private async ensureUserNode(companyId: string, projectId: string, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [user] = await this.db.withTenant(companyId, sql => sql<{ id: string; firstName: string; lastName: string; email: string }[]>`
      SELECT id, first_name, last_name, email FROM users WHERE id = ${userId}`);
    if (!user) return null;
    const label = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const node = await this.graph.upsertNode(companyId, {
      projectId, nodeType: 'user', entityId: user.id, entityTable: 'users', label,
    });
    return node.id;
  }

  // ── Location hierarchy (Building -> Level -> Location) ─────────────────────

  async extractLocationHierarchy(companyId: string, projectId: string): Promise<void> {
    const buildings = await this.db.withTenant(companyId, sql => sql<{ id: string; name: string; code: string | null }[]>`
      SELECT id, name, code FROM buildings WHERE project_id = ${projectId}`);
    const buildingNodeIds = new Map<string, string>();
    for (const b of buildings) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'building', entityId: b.id, entityTable: 'buildings',
        label: b.code ? `${b.code} — ${b.name}` : b.name,
      });
      buildingNodeIds.set(b.id, node.id);
    }

    const levels = await this.db.withTenant(companyId, sql => sql<{ id: string; buildingId: string; name: string }[]>`
      SELECT l.id, l.building_id, l.name FROM levels l
      JOIN buildings b ON b.id = l.building_id WHERE b.project_id = ${projectId}`);
    const levelNodeIds = new Map<string, string>();
    for (const l of levels) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'level', entityId: l.id, entityTable: 'levels', label: l.name,
      });
      levelNodeIds.set(l.id, node.id);
      const buildingNodeId = buildingNodeIds.get(l.buildingId);
      if (buildingNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: buildingNodeId,
          relationshipType: 'BELONGS_TO', source: 'EXPLICIT', confidence: 1,
        });
      }
    }

    const locations = await this.db.withTenant(companyId, sql => sql<{ id: string; levelId: string | null; name: string | null; drawingId: string | null; elementId: string | null }[]>`
      SELECT loc.id, loc.level_id, loc.name, loc.drawing_id, loc.element_id
      FROM locations loc
      LEFT JOIN levels lv ON lv.id = loc.level_id
      LEFT JOIN buildings b ON b.id = lv.building_id
      LEFT JOIN drawings d ON d.id = loc.drawing_id
      WHERE loc.archived_at IS NULL AND (b.project_id = ${projectId} OR d.project_id = ${projectId})`);
    for (const loc of locations) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'location', entityId: loc.id, entityTable: 'locations',
        label: loc.name || 'Location',
      });
      const levelNodeId = loc.levelId ? levelNodeIds.get(loc.levelId) : undefined;
      if (levelNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: levelNodeId,
          relationshipType: 'BELONGS_TO', source: 'EXPLICIT', confidence: 1,
        });
      }
      if (loc.drawingId) {
        const drawingNode = await this.graph.getNodeByEntity(companyId, 'drawing', loc.drawingId);
        if (drawingNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: drawingNode.id, toNodeId: node.id,
            relationshipType: 'CONTAINS', source: 'EXPLICIT', confidence: 1,
          });
        }
      }
      if (loc.elementId) {
        const elementNode = await this.graph.getNodeByEntity(companyId, 'bim_element', loc.elementId);
        if (elementNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: node.id, toNodeId: elementNode.id,
            relationshipType: 'REFERENCES', source: 'EXPLICIT', confidence: 1,
          });
        }
      }
    }
  }

  // ── BIM elements ─────────────────────────────────────────────────────────

  async extractBimElements(companyId: string, projectId: string, onlyId?: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      id: string; modelId: string; levelId: string | null; ifcType: string | null; ifcName: string | null;
      ifcGuid: string; constructionStatus: string | null;
    }[]>`
      SELECT id, model_id, level_id, ifc_type, ifc_name, ifc_guid, construction_status
      FROM bim_elements
      WHERE project_id = ${projectId} ${onlyId ? sql`AND id = ${onlyId}` : sql``}`);

    for (const el of rows) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'bim_element', entityId: el.id, entityTable: 'bim_elements',
        label: el.ifcName || el.ifcType || el.ifcGuid,
        status: el.constructionStatus,
      });
      if (el.levelId) {
        const levelNode = await this.graph.getNodeByEntity(companyId, 'level', el.levelId);
        if (levelNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: node.id, toNodeId: levelNode.id,
            relationshipType: 'LOCATED_AT', source: 'EXPLICIT', confidence: 1,
          });
        }
      }
      const modelNode = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'bim_model', entityId: el.modelId, entityTable: 'bim_models', label: 'BIM Model',
      });
      await this.graph.upsertEdge(companyId, {
        projectId, fromNodeId: node.id, toNodeId: modelNode.id,
        relationshipType: 'BELONGS_TO', source: 'EXPLICIT', confidence: 1,
      });
    }
  }

  // ── Drawings ─────────────────────────────────────────────────────────────

  async extractDrawings(companyId: string, projectId: string, onlyId?: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      id: string; levelId: string | null; locationId: string | null; drawingNumber: string | null;
      title: string | null; isCurrent: boolean;
    }[]>`
      SELECT id, level_id, location_id, drawing_number, title, is_current
      FROM drawings
      WHERE project_id = ${projectId} ${onlyId ? sql`AND id = ${onlyId}` : sql``}`);

    for (const d of rows) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'drawing', entityId: d.id, entityTable: 'drawings',
        label: d.drawingNumber ? `${d.drawingNumber} — ${d.title ?? ''}`.trim() : (d.title || 'Drawing'),
        status: d.isCurrent ? 'current' : 'superseded',
      });
      if (d.levelId) {
        const levelNode = await this.graph.getNodeByEntity(companyId, 'level', d.levelId);
        if (levelNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: node.id, toNodeId: levelNode.id,
            relationshipType: 'LOCATED_AT', source: 'EXPLICIT', confidence: 1,
          });
        }
      }
      if (d.locationId) {
        const locNode = await this.graph.getNodeByEntity(companyId, 'location', d.locationId);
        if (locNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: node.id, toNodeId: locNode.id,
            relationshipType: 'REFERENCES', source: 'EXPLICIT', confidence: 1,
          });
        }
      }
    }
  }

  // ── RFIs (no location/drawing/element FK exists on this table today) ───────

  async extractRfis(companyId: string, projectId: string, onlyId?: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      id: string; rfiNumber: string; subject: string; discipline: RfiDiscipline | null; priority: string;
      status: string; dueDate: string | null; assignedTo: string | null; createdBy: string; createdAt: string;
    }[]>`
      SELECT id, rfi_number, subject, discipline, priority, status, due_date, assigned_to, created_by, created_at
      FROM rfis
      WHERE project_id = ${projectId} ${onlyId ? sql`AND id = ${onlyId}` : sql``}`);

    for (const rfi of rows) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'rfi', entityId: rfi.id, entityTable: 'rfis',
        label: `${rfi.rfiNumber} — ${rfi.subject}`,
        discipline: rfi.discipline ? RFI_DISCIPLINE_TO_RISK_DISCIPLINE[rfi.discipline] : null,
        status: rfi.status, priority: rfi.priority, dueDate: rfi.dueDate,
        metadata: { createdAt: rfi.createdAt },
      });

      const assignedNodeId = await this.ensureUserNode(companyId, projectId, rfi.assignedTo);
      if (assignedNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: assignedNodeId,
          relationshipType: 'ASSIGNED_TO', source: 'EXPLICIT', confidence: 1,
        });
      }
      const ownerNodeId = await this.ensureUserNode(companyId, projectId, rfi.createdBy);
      if (ownerNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: ownerNodeId,
          relationshipType: 'OWNED_BY', source: 'EXPLICIT', confidence: 1,
        });
      }
    }
  }

  // ── Submittals (no location/drawing FK exists on this table today, exactly like RFIs) ──

  async extractSubmittals(companyId: string, projectId: string, onlyId?: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      id: string; submittalNumber: string; title: string; discipline: string | null; priority: string;
      status: string; dueDate: string | null; assignedTo: string | null; createdBy: string; createdAt: string;
    }[]>`
      SELECT id, submittal_number, title, discipline, priority, status, due_date, assigned_to, created_by, created_at
      FROM submittals
      WHERE project_id = ${projectId} ${onlyId ? sql`AND id = ${onlyId}` : sql``}`);

    for (const s of rows) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'submittal', entityId: s.id, entityTable: 'submittals',
        label: `${s.submittalNumber} — ${s.title}`,
        discipline: canonicalizeFreeTextDiscipline(s.discipline),
        status: s.status, priority: s.priority, dueDate: s.dueDate,
        metadata: { createdAt: s.createdAt },
      });

      const assignedNodeId = await this.ensureUserNode(companyId, projectId, s.assignedTo);
      if (assignedNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: assignedNodeId,
          relationshipType: 'ASSIGNED_TO', source: 'EXPLICIT', confidence: 1,
        });
      }
      const ownerNodeId = await this.ensureUserNode(companyId, projectId, s.createdBy);
      if (ownerNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: ownerNodeId,
          relationshipType: 'OWNED_BY', source: 'EXPLICIT', confidence: 1,
        });
      }
    }
  }

  // ── Issues (the richest-linked entity in the schema) ────────────────────────

  async extractIssues(companyId: string, projectId: string, onlyId?: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      id: string; issueNumber: string | null; title: string; discipline: IssueDiscipline; priority: string;
      status: string; deadline: string | null; buildingId: string | null; levelId: string | null;
      locationId: string | null; elementId: string | null; drawingId: string | null; captureId: string | null;
      assignedTo: string | null;
    }[]>`
      SELECT id, issue_number, title, discipline, priority, status, deadline,
             building_id, level_id, location_id, element_id, drawing_id, capture_id, assigned_to
      FROM issues
      WHERE project_id = ${projectId} ${onlyId ? sql`AND id = ${onlyId}` : sql``}`);

    for (const issue of rows) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'issue', entityId: issue.id, entityTable: 'issues',
        label: issue.issueNumber ? `${issue.issueNumber} — ${issue.title}` : issue.title,
        discipline: ISSUE_DISCIPLINE_TO_RISK_DISCIPLINE[issue.discipline],
        status: issue.status, priority: issue.priority, dueDate: issue.deadline,
      });

      const linkLocation = async (targetType: 'building' | 'level' | 'location', targetId: string | null) => {
        if (!targetId) return;
        const targetNode = await this.graph.getNodeByEntity(companyId, targetType, targetId);
        if (targetNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: node.id, toNodeId: targetNode.id,
            relationshipType: 'LOCATED_AT', source: 'EXPLICIT', confidence: 1,
          });
        }
      };
      await linkLocation('building', issue.buildingId);
      await linkLocation('level', issue.levelId);
      await linkLocation('location', issue.locationId);

      if (issue.elementId) {
        const elNode = await this.graph.getNodeByEntity(companyId, 'bim_element', issue.elementId);
        if (elNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: node.id, toNodeId: elNode.id,
            relationshipType: 'AFFECTS', source: 'EXPLICIT', confidence: 1,
          });
        }
      }
      if (issue.drawingId) {
        const drNode = await this.graph.getNodeByEntity(companyId, 'drawing', issue.drawingId);
        if (drNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: node.id, toNodeId: drNode.id,
            relationshipType: 'REFERENCES', source: 'EXPLICIT', confidence: 1,
          });
        }
      }
      if (issue.captureId) {
        const [capture] = await this.db.withTenant(companyId, sql => sql<{ id: string; title: string | null; captureType: string }[]>`
          SELECT id, title, capture_type FROM captures WHERE id = ${issue.captureId}`);
        if (capture) {
          const captureNode = await this.graph.upsertNode(companyId, {
            projectId, nodeType: 'capture', entityId: capture.id, entityTable: 'captures',
            label: capture.title || capture.captureType,
          });
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: captureNode.id, toNodeId: node.id,
            relationshipType: 'EVIDENCE_FOR', source: 'EXPLICIT', confidence: 1,
          });
        }
      }
      const assignedNodeId = await this.ensureUserNode(companyId, projectId, issue.assignedTo);
      if (assignedNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: assignedNodeId,
          relationshipType: 'ASSIGNED_TO', source: 'EXPLICIT', confidence: 1,
        });
      }
    }
  }

  // ── Snag items ───────────────────────────────────────────────────────────

  async extractSnagItems(companyId: string, projectId: string, onlyId?: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      id: string; snagNumber: string; title: string; priority: string; status: string; dueDate: string | null;
      buildingId: string | null; levelId: string | null; locationId: string | null; assignedTo: string | null;
    }[]>`
      SELECT id, snag_number, title, priority, status, due_date, building_id, level_id, location_id, assigned_to
      FROM snag_items
      WHERE project_id = ${projectId} ${onlyId ? sql`AND id = ${onlyId}` : sql``}`);

    for (const snag of rows) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'snag_item', entityId: snag.id, entityTable: 'snag_items',
        label: `${snag.snagNumber} — ${snag.title}`,
        status: snag.status, priority: snag.priority, dueDate: snag.dueDate,
      });

      const linkLocation = async (targetType: 'building' | 'level' | 'location', targetId: string | null) => {
        if (!targetId) return;
        const targetNode = await this.graph.getNodeByEntity(companyId, targetType, targetId);
        if (targetNode) {
          await this.graph.upsertEdge(companyId, {
            projectId, fromNodeId: node.id, toNodeId: targetNode.id,
            relationshipType: 'LOCATED_AT', source: 'EXPLICIT', confidence: 1,
          });
        }
      };
      await linkLocation('building', snag.buildingId);
      await linkLocation('level', snag.levelId);
      await linkLocation('location', snag.locationId);

      const assignedNodeId = await this.ensureUserNode(companyId, projectId, snag.assignedTo);
      if (assignedNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: assignedNodeId,
          relationshipType: 'ASSIGNED_TO', source: 'EXPLICIT', confidence: 1,
        });
      }
    }
  }

  // ── QA inspections (weakest-linked module -- free-text location only) ──────

  async extractQaInspections(companyId: string, projectId: string, onlyId?: string): Promise<void> {
    const rows = await this.db.withTenant(companyId, sql => sql<{
      id: string; inspectionNumber: string; title: string; status: string; assignedTo: string | null;
    }[]>`
      SELECT id, inspection_number, title, status, assigned_to
      FROM qa_inspections
      WHERE project_id = ${projectId} ${onlyId ? sql`AND id = ${onlyId}` : sql``}`);

    for (const qa of rows) {
      const node = await this.graph.upsertNode(companyId, {
        projectId, nodeType: 'qa_inspection', entityId: qa.id, entityTable: 'qa_inspections',
        label: `${qa.inspectionNumber} — ${qa.title}`, status: qa.status,
      });
      const assignedNodeId = await this.ensureUserNode(companyId, projectId, qa.assignedTo);
      if (assignedNodeId) {
        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: node.id, toNodeId: assignedNodeId,
          relationshipType: 'ASSIGNED_TO', source: 'EXPLICIT', confidence: 1,
        });
      }
    }
  }

  // ── Inferred RFI <-> Issue relationships ────────────────────────────────────
  //
  // RFIs carry no location/drawing/element FK (see architecture assessment),
  // so the only way to connect an RFI to the rest of the project graph is
  // inference: same canonical discipline + created within
  // RFI_ISSUE_MAX_DAY_GAP days of each other + optional subject/title word
  // overlap. Every edge this produces is source=RULE_INFERENCE with
  // confidence < 1 and a stored `evidence` explaining exactly what matched
  // -- never presented as a confirmed relationship (brief section 6).

  async extractInferredRfiIssueLinks(companyId: string, projectId: string): Promise<void> {
    const rfis = await this.db.withTenant(companyId, sql => sql<{
      id: string; subject: string; discipline: RfiDiscipline | null; createdAt: string;
    }[]>`SELECT id, subject, discipline, created_at FROM rfis WHERE project_id = ${projectId}`);
    const issues = await this.db.withTenant(companyId, sql => sql<{
      id: string; title: string; discipline: IssueDiscipline; createdAt: string;
    }[]>`SELECT id, title, discipline, created_at FROM issues WHERE project_id = ${projectId}`);

    if (rfis.length === 0 || issues.length === 0) return;

    for (const rfi of rfis) {
      if (!rfi.discipline) continue;
      const rfiCanonicalDiscipline = RFI_DISCIPLINE_TO_RISK_DISCIPLINE[rfi.discipline];
      const rfiDate = new Date(rfi.createdAt).getTime();

      for (const issue of issues) {
        const issueCanonicalDiscipline = ISSUE_DISCIPLINE_TO_RISK_DISCIPLINE[issue.discipline];
        const dayGap = Math.abs(new Date(issue.createdAt).getTime() - rfiDate) / (1000 * 60 * 60 * 24);
        const confidence = computeInferredRfiIssueConfidence(rfiCanonicalDiscipline, issueCanonicalDiscipline, dayGap, rfi.subject, issue.title);
        if (confidence === null) continue;

        const rfiNode = await this.graph.getNodeByEntity(companyId, 'rfi', rfi.id);
        const issueNode = await this.graph.getNodeByEntity(companyId, 'issue', issue.id);
        if (!rfiNode || !issueNode) continue;

        await this.graph.upsertEdge(companyId, {
          projectId, fromNodeId: rfiNode.id, toNodeId: issueNode.id,
          relationshipType: 'RELATED_TO', source: 'RULE_INFERENCE', confidence,
          evidence: {
            reason: 'same_discipline_and_time_proximity',
            discipline: rfiCanonicalDiscipline,
            dayGap: Math.round(dayGap * 10) / 10,
          },
        });
      }
    }
  }
}
