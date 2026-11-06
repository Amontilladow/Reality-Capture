import type { TransactionSql } from 'postgres';

interface OrgMappingRow {
  pattern: string;
  organizationName: string;
  role: 'originator' | 'subcontractor';
}

// Master spec section 4: resolve a drawing's originator/subcontractor from
// the project's own site_drawing_org_mappings (a human-maintained
// "drawing numbers starting with X belong to organization Y" lookup),
// never from a guess over title-block text. Matched as a case-insensitive
// drawing-number prefix; the longest matching pattern wins when more than
// one applies (e.g. both "S-" and "S-ACME-" mapped to different
// organizations). Call inside the same withTenant transaction the caller
// already has open; the mappings table is small (a handful of rows per
// project), so one SELECT of all of them and an in-memory match is simpler
// and just as fast as a per-call prefix query.
export async function resolveOrgMapping(
  sql: TransactionSql, projectId: string, drawingNumber: string,
): Promise<{ originator?: string; responsibleSubcontractor?: string }> {
  const mappings = await sql<OrgMappingRow[]>`
    SELECT pattern, organization_name AS "organizationName", role FROM site_drawing_org_mappings WHERE project_id = ${projectId}
  `;
  const upper = drawingNumber.toUpperCase();

  function bestMatch(role: OrgMappingRow['role']): string | undefined {
    let best: OrgMappingRow | undefined;
    for (const m of mappings) {
      if (m.role !== role) continue;
      if (upper.startsWith(m.pattern.toUpperCase()) && (!best || m.pattern.length > best.pattern.length)) best = m;
    }
    return best?.organizationName;
  }

  return { originator: bestMatch('originator'), responsibleSubcontractor: bestMatch('subcontractor') };
}
