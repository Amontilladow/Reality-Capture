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
  // Org-category sprint additions (packages/types/src/user.types.ts) --
  // the AI Assistant isn't part of that sprint's permission matrix (owner's
  // matrix section 7: "unchanged from existing behavior"), so these just
  // need a sensible bucket, same manager-tier default as the rest of
  // Management/Document Control above.
  chairman:                     { dailyLimit: 30, perMinuteLimit: 10 },
  general_manager:              { dailyLimit: 30, perMinuteLimit: 10 },
  operations_manager:           { dailyLimit: 30, perMinuteLimit: 10 },
  project_document_controller:  { dailyLimit: 30, perMinuteLimit: 10 },
  // Individual-contributor placeholders -- same lower bucket as
  // project_engineer/the default, not the manager-tier one above.
  document_control_assistant:   { dailyLimit: 20, perMinuteLimit: 5  },
  engineering_team_member:      { dailyLimit: 20, perMinuteLimit: 5  },
  qaqc_team_member:             { dailyLimit: 20, perMinuteLimit: 5  },
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
    // gemini-2.0-flash was retired by Google (confirmed via a live 404
    // directing us to gemini-3.8-flash). That model, and gemini-3.7-flash
    // after it, both returned 503 "experiencing high demand" in production
    // -- gemini-3.5-flash-lite is the first one confirmed actually working
    // end to end (real answers, grounded in real project data, verified in
    // production). GEMINI_MODEL still overrides this whenever Google moves
    // the goalposts again.
    model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite',
    // Owner request, after gemini-3.5-flash-lite ALSO hit a transient 503
    // "experiencing high demand" in production (the third model tier to do
    // so in one day): GeminiProvider now retries a failed request against
    // each of these, in order, before giving up -- a different model is
    // very likely a different capacity pool, so a spike on one rarely hits
    // all of them at once. gemini-3.1-flash-lite is Google's current
    // budget-tier model per their own docs; 3.8-flash/3.7-flash are kept in
    // rotation since "experiencing high demand" is explicitly described as
    // usually-temporary, so a model that 503'd earlier today may well have
    // recovered by the time a real request hits it. GEMINI_FALLBACK_MODELS
    // (comma-separated) overrides this list entirely, including to empty
    // ("") to disable fallback.
    fallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.1-flash-lite,gemini-3.8-flash,gemini-3.7-flash')
      .split(',').map((m) => m.trim()).filter(Boolean),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
  },
  // A third-party OpenAI-compatible gateway (e.g. a multi-model API
  // reseller) rather than OpenAI itself -- OpenAICompatibleProvider
  // already supports an arbitrary baseURL (it also backs the BYO
  // "custom_openai_compatible"/"ollama" cases in provider.factory.ts), so
  // this is just RealityCapture's own provider pointed at a different
  // OpenAI-compatible endpoint. CUSTOM_OPENAI_MODEL must match a model
  // name the gateway actually serves -- check the provider's own docs/
  // dashboard; this default is a placeholder, not a verified working value.
  customOpenAICompatible: {
    baseUrl: process.env.CUSTOM_OPENAI_BASE_URL ?? '',
    apiKey: process.env.CUSTOM_OPENAI_API_KEY ?? '',
    model: process.env.CUSTOM_OPENAI_MODEL ?? 'gpt-4o',
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
    chairman:                    parseLimitOverride(process.env.AI_LIMIT_CHAIRMAN, DEFAULT_LIMITS.chairman),
    general_manager:             parseLimitOverride(process.env.AI_LIMIT_GENERAL_MANAGER, DEFAULT_LIMITS.general_manager),
    operations_manager:          parseLimitOverride(process.env.AI_LIMIT_OPERATIONS_MANAGER, DEFAULT_LIMITS.operations_manager),
    project_document_controller: parseLimitOverride(process.env.AI_LIMIT_PROJECT_DOCUMENT_CONTROLLER, DEFAULT_LIMITS.project_document_controller),
    document_control_assistant:  parseLimitOverride(process.env.AI_LIMIT_DOCUMENT_CONTROL_ASSISTANT, DEFAULT_LIMITS.document_control_assistant),
    engineering_team_member:     parseLimitOverride(process.env.AI_LIMIT_ENGINEERING_TEAM_MEMBER, DEFAULT_LIMITS.engineering_team_member),
    qaqc_team_member:            parseLimitOverride(process.env.AI_LIMIT_QAQC_TEAM_MEMBER, DEFAULT_LIMITS.qaqc_team_member),
    default:               parseLimitOverride(process.env.AI_LIMIT_DEFAULT, DEFAULT_LIMITS.default),
  } satisfies Record<CompanyRole | 'default', AiRoleLimit>,

  maxConversationTurns: parseInt(process.env.AI_MAX_CONVERSATION_TURNS ?? '6', 10),
  maxQuestionLength: parseInt(process.env.AI_MAX_QUESTION_LENGTH ?? '2000', 10),
}));
