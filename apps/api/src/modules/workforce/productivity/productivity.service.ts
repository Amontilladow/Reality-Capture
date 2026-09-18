import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { PRODUCTIVITY_MODEL_VERSION, type ProductivityFactors, type CompanyRole } from '@engineeringos/types';
import { resolveVisibleTargetUserId } from '../workforce-visibility.util';

// Engineering-relevant activity types (brief §10's seed taxonomy) used by
// the v1 formula's "engineering share" factor. Extending this list is a
// code change here, not a migration -- activity_type stays a plain VARCHAR
// (see docs/workforce-intelligence-data-model.md).
const ENGINEERING_ACTIVITY_TYPES = new Set([
  'ENGINEERING', 'DESIGN', 'MODELING', 'DOCUMENTATION', 'REVIEW', 'COORDINATION',
]);

// v1 productivity formula -- deliberately simple and fully explainable
// (brief §14: "explainable, configurable, versioned, auditable,
// replaceable"). NEVER computed or returned without its `factors`
// breakdown alongside the score. Utilization and engineering-share are
// weighted 40/60 because engineering time-on-task matters more to this
// product's differentiator than raw active-vs-idle time (brief §6) --
// this weighting is the kind of thing product/leadership should be able
// to tune, which is exactly why it's isolated in one place, versioned,
// and never hardcoded into the schema.
const UTILIZATION_WEIGHT = 0.4;
const ENGINEERING_SHARE_WEIGHT = 0.6;

@Injectable()
export class ProductivityService {
  constructor(private readonly db: DatabaseService) {}

  // `callerId` is always the authenticated caller; `targetUserId`/
  // `callerCompanyRole` are new, trailing, optional params so every
  // existing self-view call site (which only ever passed the first four
  // arguments) keeps compiling and behaving exactly as before. When a
  // target other than the caller is requested, resolveVisibleTargetUserId()
  // enforces the chain-of-command/leadership visibility rule and throws
  // ForbiddenException if it fails.
  async getMyScore(
    companyId: string,
    callerId: string,
    periodType: 'day' | 'week',
    periodStart: string,
    targetUserId?: string,
    callerCompanyRole?: CompanyRole,
  ) {
    const userId = await resolveVisibleTargetUserId(this.db, companyId, callerId, callerCompanyRole, targetUserId);
    const { start, end } = resolvePeriod(periodType, periodStart);
    return this.computeAndPersist(companyId, userId, periodType, start, end);
  }

  // Explicit [from, to) range that doesn't align to a day/week boundary --
  // lets a caller (the Workforce page) request the score over the exact
  // same window as another endpoint's own from/to range, instead of the
  // two silently disagreeing (e.g. a trailing-7-days activity summary vs.
  // an ISO-week-to-date score). Stored as period_type 'range' so it never
  // collides with a 'day'/'week' row for the same user. Same trailing
  // targetUserId/callerCompanyRole params and visibility check as getMyScore.
  async getMyScoreForRange(
    companyId: string,
    callerId: string,
    from: string,
    to: string,
    targetUserId?: string,
    callerCompanyRole?: CompanyRole,
  ) {
    const userId = await resolveVisibleTargetUserId(this.db, companyId, callerId, callerCompanyRole, targetUserId);
    return this.computeAndPersist(companyId, userId, 'range', new Date(from), new Date(to));
  }

  private async computeAndPersist(companyId: string, userId: string, periodType: string, start: Date, end: Date) {
    return this.db.withTenant(companyId, async (sql) => {
      const rows = await sql`
        SELECT a.duration_seconds, a.activity_type, a.application_id,
               COALESCE(ar.name, a.application_name_raw) AS application_name,
               ar.engineering_relevance, ar.productivity_classification
        FROM activities a
        LEFT JOIN application_registry ar ON ar.id = a.application_id
        WHERE a.user_id = ${userId}
          AND a.started_at >= ${start.toISOString()}
          AND a.started_at < ${end.toISOString()}`;

      const factors = computeFactors(rows as unknown as ActivityAggregateRow[]);
      const score = clamp(
        100 * (UTILIZATION_WEIGHT * factors.utilization + ENGINEERING_SHARE_WEIGHT * factors.engineeringShare),
        0,
        100,
      );

      // Recalculable, not appended: a re-request for the same period under
      // the same model_version replaces the stored row rather than
      // accumulating history (brief §19).
      await sql`
        DELETE FROM productivity_scores
        WHERE user_id = ${userId} AND project_id IS NULL
          AND period_type = ${periodType} AND period_start = ${toDateOnly(start)}
          AND model_version = ${PRODUCTIVITY_MODEL_VERSION}`;

      const [saved] = await sql`
        INSERT INTO productivity_scores (
          company_id, user_id, project_id, period_type, period_start, period_end,
          score, factors, model_version
        ) VALUES (
          ${companyId}, ${userId}, NULL, ${periodType}, ${toDateOnly(start)}, ${toDateOnly(end)},
          ${score}, ${JSON.stringify(factors)}, ${PRODUCTIVITY_MODEL_VERSION}
        ) RETURNING *`;

      return saved;
    });
  }
}

function resolvePeriod(periodType: 'day' | 'week', periodStartInput?: string): { start: Date; end: Date } {
  const base = periodStartInput ? new Date(periodStartInput) : new Date();
  if (periodType === 'day') {
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }
  // Week = Monday-start, matching ISO week convention.
  const day = base.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - diffToMonday));
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface ActivityAggregateRow {
  durationSeconds: number;
  activityType: string;
  applicationId: string | null;
  applicationName: string;
  engineeringRelevance: boolean | null;
  productivityClassification?: string | null;
}

export function computeFactors(rows: ActivityAggregateRow[]): ProductivityFactors {
  let totalActiveSeconds = 0;
  let totalEngineeringSeconds = 0;
  let productiveSeconds = 0;
  let unproductiveSeconds = 0;
  let neutralSeconds = 0;
  let unclassifiedSeconds = 0;
  const totalAllSeconds = rows.reduce((sum, r) => sum + Number(r.durationSeconds), 0);
  const appTotals = new Map<string, { applicationId: string | null; name: string; seconds: number }>();

  for (const row of rows) {
    const seconds = Number(row.durationSeconds);
    if (row.activityType !== 'IDLE') {
      totalActiveSeconds += seconds;
      // DeskTime-style productive/unproductive/neutral breakdown -- like
      // DeskTime, idle time is excluded entirely (it's neither productive
      // nor unproductive, it's just not tracked activity). An app that's
      // never been classified by an admin (including one auto-registered
      // by ingest() moments ago) counts as its own bucket rather than
      // silently defaulting into "neutral" or "productive" -- an
      // unreviewed app should read as unreviewed, not as a productivity
      // verdict nobody actually made.
      switch (row.productivityClassification) {
        case 'productive': productiveSeconds += seconds; break;
        case 'unproductive': unproductiveSeconds += seconds; break;
        case 'neutral': neutralSeconds += seconds; break;
        default: unclassifiedSeconds += seconds; break;
      }
    }
    if (ENGINEERING_ACTIVITY_TYPES.has(row.activityType) || row.engineeringRelevance) {
      totalEngineeringSeconds += seconds;
    }
    const key = row.applicationId ?? row.applicationName;
    const existing = appTotals.get(key) ?? { applicationId: row.applicationId, name: row.applicationName, seconds: 0 };
    existing.seconds += seconds;
    appTotals.set(key, existing);
  }

  const topApplications = [...appTotals.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 5);

  return {
    utilization: totalAllSeconds > 0 ? totalActiveSeconds / totalAllSeconds : 0,
    engineeringShare: totalActiveSeconds > 0 ? totalEngineeringSeconds / totalActiveSeconds : 0,
    totalActiveSeconds,
    totalEngineeringSeconds,
    topApplications,
    productiveSeconds,
    unproductiveSeconds,
    neutralSeconds,
    unclassifiedSeconds,
    // DeskTime's own headline metric: productive time as a share of all
    // tracked (non-idle) time. Deliberately NOT blended into `score` --
    // the v1 formula above is already versioned/persisted and changing its
    // weights would silently rewrite the meaning of every already-computed
    // historical score. This is an additional, explainable breakdown
    // alongside it, not a competing model.
    productivityRatio: totalActiveSeconds > 0 ? productiveSeconds / totalActiveSeconds : 0,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
}
