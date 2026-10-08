import { registerAs } from '@nestjs/config';
import type { CompanyRole } from '@engineeringos/types';

// Section 12 of the AI rebuild spec: initial testing limits, explicitly NOT
// meant to be permanent -- centralized here (env-overridable) rather than
// hard-coded in AiUsageService, so they can later move to an admin-editable
// DB-backed config without touching any call site. Roles not listed fall
// back to the 'default' bucket (spec's "OTHER / STANDARD USER").
export interface AiRoleLimit {
  dailyLimit: number;
  perMinuteLimit: number;
}

const DEFAULT_LIMITS: Record<string, AiRoleLimit> = {
  super_admin:          { dailyLimit: 100, perMinuteLimit: 20 },
  company_admin:        { dailyLimit: 100, perMinuteLimit: 20 },
  technical_director:   { dailyLimit: 30,  perMinuteLimit: 10 },
  engineering_manager:  { dailyLimit: 30,  perMinuteLimit: 10 },
  bim_manager:          { dailyLimit: 30,  perMinuteLimit: 10 },
  project_manager:      { dailyLimit: 30,  perMinuteLimit: 10 },
  construction_manager: { dailyLimit: 30,  perMinuteLimit: 10 },
  qa_qc_manager:        { dailyLimit: 30,  perMinuteLimit: 10 },
  commercial_manager:   { dailyLimit: 30,  perMinuteLimit: 10 },
  consultant:           { dailyLimit: 30,  perMinuteLimit: 10 },
  client_representative:{ dailyLimit: 30,  perMinuteLimit: 10 },
  // CTO spec section 22: Project Engineer is one of the three restricted
  // site-facing roles, limited like the spec's "Site Engineer" bucket
  // (20/day, 5/min) rather than the general 30/day manager bucket.
  project_engineer:      { dailyLimit: 20,  perMinuteLimit: 5  },
  default:               { dailyLimit: 20,  perMinuteLimit: 5  },
};

function parseLimitOverride(envVar: string | undefined, fallback: AiRoleLimit): AiRoleLimit {
  if (!envVar) return fallback;
  const [daily, perMinute] = envVar.split(',').map((n) => parseInt(n.trim(), 10));
  return {
    dailyLimit: Number.isFinite(daily) ? daily : fallback.dailyLimit,
    perMinuteLimit: Number.isFinite(perMinute) ? perMinute : fallback.perMinuteLimit,
  };
}

export default registerAs('ai', () => ({
  // AI_PROVIDER unset or 'auto' -- pick gemini if GEMINI_API_KEY is present,
  // else anthropic if ANTHROPIC_API_KEY is present, else fail closed at
  // startup (ProviderFactory throws rather than silently running with no
  // provider). Explicit 'gemini'/'anthropic' forces that adapter regardless
  // of which keys are set, so an operator can force a provider error instead
  // of a silent fallback if that's what they want.
  provider: process.env.AI_PROVIDER ?? 'auto',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
  },

  // Per-role daily + per-minute request limits ("INITIAL TESTING LIMITS" in
  // the spec, env-overridable as "daily,perMinute", e.g.
  // AI_LIMIT_CONSULTANT=50,15). Not meant to be the last word -- an Admin UI
  // writing to a DB-backed table is the natural next step; this is the
  // minimal version that satisfies "configurable, not hard-coded throughout
  // the code" without building that UI now.
  roleLimits: {
    super_admin:           parseLimitOverride(process.env.AI_LIMIT_SUPER_ADMIN, DEFAULT_LIMITS.super_admin),
    company_admin:         parseLimitOverride(process.env.AI_LIMIT_COMPANY_ADMIN, DEFAULT_LIMITS.company_admin),
    technical_director:    parseLimitOverride(process.env.AI_LIMIT_TECHNICAL_DIRECTOR, DEFAULT_LIMITS.technical_director),
    engineering_manager:   parseLimitOverride(process.env.AI_LIMIT_ENGINEERING_MANAGER, DEFAULT_LIMITS.engineering_manager),
    bim_manager:           parseLimitOverride(process.env.AI_LIMIT_BIM_MANAGER, DEFAULT_LIMITS.bim_manager),
    project_manager:       parseLimitOverride(process.env.AI_LIMIT_PROJECT_MANAGER, DEFAULT_LIMITS.project_manager),
    construction_manager:  parseLimitOverride(process.env.AI_LIMIT_CONSTRUCTION_MANAGER, DEFAULT_LIMITS.construction_manager),
    qa_qc_manager:         parseLimitOverride(process.env.AI_LIMIT_QA_QC_MANAGER, DEFAULT_LIMITS.qa_qc_manager),
    commercial_manager:    parseLimitOverride(process.env.AI_LIMIT_COMMERCIAL_MANAGER, DEFAULT_LIMITS.commercial_manager),
    consultant:            parseLimitOverride(process.env.AI_LIMIT_CONSULTANT, DEFAULT_LIMITS.consultant),
    client_representative: parseLimitOverride(process.env.AI_LIMIT_CLIENT_REPRESENTATIVE, DEFAULT_LIMITS.client_representative),
    project_engineer:      parseLimitOverride(process.env.AI_LIMIT_PROJECT_ENGINEER, DEFAULT_LIMITS.project_engineer),
    default:               parseLimitOverride(process.env.AI_LIMIT_DEFAULT, DEFAULT_LIMITS.default),
  } satisfies Record<CompanyRole | 'default', AiRoleLimit>,

  maxConversationTurns: parseInt(process.env.AI_MAX_CONVERSATION_TURNS ?? '6', 10),
  maxQuestionLength: parseInt(process.env.AI_MAX_QUESTION_LENGTH ?? '2000', 10),
}));
