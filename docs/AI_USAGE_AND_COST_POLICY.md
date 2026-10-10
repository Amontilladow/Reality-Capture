# EngineeringOS — AI Usage and Cost Policy

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Verified against the actual code in `apps/api/src/modules/ai/`, `ai-connections/`, and `ai_usage_log` (migration 062). Each section states what is **implemented and verified**, what is a **confirmed gap**, and what is **proposed only** — no new paid service, API, or infrastructure is proposed anywhere in this document without saying so explicitly and estimating its cost.

---

## 1. Server-side quota enforcement — VERIFIED, bypass-resistant

`AiUsageService.checkAndReserve()` (`ai-usage.service.ts:72-93`) is the only path to calling a provider (`AiService.ask()` calls it before `resolveProvider()`). It is:

- **Server-side only.** No client-supplied value participates in the limit check; the limit is looked up server-side by the authenticated user's role.
- **Atomic.** Uses Redis `INCR` on a per-user-per-day key and a per-user-per-minute key, in that order, with rollback (`DECR`) if either is exceeded. Two concurrent requests from the same user cannot both slip through under the limit — `INCR` is atomic at the Redis level, there is no read-then-write race.
- **Pre-reserved, not post-counted.** The quota is consumed by `checkAndReserve()` itself, before the provider is ever called — a request that fails after reservation (caught in `ask()`'s `catch` block) still logs `status: 'error'` but the quota consumption already happened, which is the conservative (harder-to-exploit) direction to err in.
- **Per-role, configurable without a deploy for env-settable overrides** (`AI_LIMIT_<ROLE>=daily,perMinute` — `ai.config.ts:64-83`), defaulting to 100/day for admins down to 20/day (5/min) for site-restricted roles.
- **Not spent by a blocked question.** `DomainGuardService.evaluate()` runs first and unconditionally (`ai.service.ts` — see the domain-guard section of `AI_EVALUATION_FRAMEWORK.md`); an off-topic or draft-blocked request never reaches `checkAndReserve()`, confirmed by the existing test `'blocks an off-topic question before checking usage or calling the provider'` in `ai.service.spec.ts`.

**No bypass path found.** This was tested directly in this phase, not just read: the quota check happens before provider resolution, before BYO-vs-platform routing, and cannot be skipped by any request shape the DTO (`AskAssistantDto`) accepts.

**Gap, not a bypass:** the daily/minute counters live only in Redis with a ~26-hour TTL — there is no month-to-date or all-time spend counter anywhere. §6 covers what that means for budgeting.

## 2. Caching — NOT implemented; guidelines for if it ever is

No response cache exists for AI requests today — confirmed by reading `ai.service.ts` end to end; every allowed request calls the provider. This is not flagged as a defect: construction-project questions ("what's overdue on this project") are rarely identical twice and almost always need fresh data, so a naive cache would often serve stale or wrong answers, which is worse than the cost it would save.

**If caching is ever added**, these constraints are non-negotiable, consistent with this phase's own privacy rules:
- Cache key must include `companyId` + `projectId` + the exact tool-call parameters — never cache across companies or projects under any circumstance (this is the same tenant-isolation boundary as everything else in this codebase).
- Never cache a response that depended on live, time-sensitive tool data (open RFI counts, overdue issues) beyond a very short TTL (seconds, not hours) — a stale "no overdue issues" answer is actively harmful.
- Never cache a BYO-mode response under the platform's own cache — that would mean one company's AI spend silently subsidizing another's answer, and crosses the BYO privacy boundary (a company's own provider, own data).
- A draft response (`generateDraft()`) should never be cached at all — it's meant to be a one-off, user-reviewed suggestion, not a reusable answer.

**Recommendation: do not implement caching now.** There's no measured evidence of repeated identical questions driving cost (no query-level analytics exist yet to even check this — see `PRODUCT_ANALYTICS_AND_ADOPTION.md`), so this would be optimizing before measuring, which this phase's brief explicitly warns against.

## 3. RAG (retrieval-augmented generation) from authorized documents — NOT implemented; feasibility only

Today, the AI's only access to project data is the fixed set of read tools in `ai-tools.service.ts` (`getProjectSummary`, `getOpenRfis`, etc.) — structured DB queries, not document retrieval. There is no vector store, no document embedding pipeline, and no RAG infrastructure anywhere in this codebase.

**Feasibility, not a recommendation to build now:**
- Project documents (drawings, specs, RFI attachments) already carry the same `company_id`/`project_id` scoping and the same `RolesGuard`/`ProjectPermissionGuard` chain as everything else — a RAG layer could reuse that exact authorization path for retrieval filtering, which is the hard part of doing this safely.
- Standing up a vector store is a genuinely new piece of infrastructure (even a self-hosted `pgvector` extension on the existing Postgres instance, which would be the lowest-cost option, still needs an embedding model — either a paid API call per document or a self-hosted embedding model with its own compute cost).
- **This requires explicit cost approval before any implementation** per this phase's constraints — an embedding API has a real, ongoing, volume-dependent cost that cannot be estimated without knowing how many documents a typical company has, which isn't measured today.
- No user-facing problem statement currently supports this: the existing tool-based approach already answers structured questions; the AI rebuild's own Known Limitations never raised "can't find information in documents" as a reported gap. **Not recommended for the near term** absent a demonstrated need.

## 4. Model tiering — NOT implemented

There is exactly one model per mode (RealityCapture's single configured Mode A provider; whatever the user's BYO connection specifies for Mode B) — no cheap-model-first / escalate-to-expensive-model-on-failure logic exists in `AiService`.

**Feasibility:** the existing `AIProvider` interface and `ProviderFactory` already support holding more than one provider instance; tiering (e.g., try a cheap/fast model for simple lookups, fall back to a stronger model for drafting) is architecturally straightforward to add later. **Not recommended now** — there's no measured cost or latency problem driving this (no historical token-cost data existed at all until this phase's fix, see §7), so there's nothing yet to optimize against.

## 5. CONFIRMED RISK — automatic fallback to the platform's paid provider, with no approval or spending-limit gate

This is the most significant finding in this document and needs your decision, not a unilateral fix.

**What the code actually does** (`ai.service.ts`, `resolveProvider()`, lines 121-127):

```ts
private async resolveProvider(user): Promise<{ provider; mode }> {
  const byo = await this.aiConnections.getProviderForUser(user.companyId, user.id)
    .catch((err) => { this.logger.warn(`BYO provider resolution failed, falling back...`); return null; });
  if (byo) return { provider: byo, mode: 'byo' };
  return { provider: this.providerFactory.getProvider(), mode: 'realitycapture' };
}
```

The `.catch()` swallows **any** error from BYO resolution — not just "no connection configured," but also a decrypt failure, a malformed stored credential, or (confirmed by a passing test in `ai.service.spec.ts`: `'falls back to RealityCapture AI... when BYO provider resolution itself errors'`) the user's own provider being unreachable or rejecting the request. In every one of those cases, the request silently proceeds against **RealityCapture's own, platform-paid provider** instead of failing or warning the user.

**Why this matters for cost control:** a company that explicitly chose BYO AI specifically to control or avoid platform AI spend has no guarantee that choice holds — a misconfigured credential or a transient outage on their own provider's side causes their users' requests to silently bill the platform's own API key instead, with:
- No per-company approval step before this happens.
- No spending limit on how much platform spend a fallback can accumulate.
- No alert to the company admin that it happened (only a backend log line visible to engineers, not the customer).
- The `ai_usage_log` row for the fallback request does correctly record `aiMode: 'realitycapture'` (confirmed — this field is already populated and distinguishes the two modes), so the fact that a fallback occurred is technically recoverable from the data, but nothing surfaces it proactively today.

**This document does not fix this unilaterally** — both options below are legitimate product decisions:

| Option | Effect | Cost/effort |
|---|---|---|
| **A. Fail the request instead of falling back** (when the user has a BYO connection configured but it errors) | User gets a clear "your connected AI provider is unavailable" error instead of an answer; zero extra platform spend ever occurs from BYO failures | Small code change (remove the silent `.catch()` fallback for *configured* BYO connections specifically — a user with no connection at all should still fall back to Mode A, that's correct and intended) |
| **B. Keep the fallback, but gate it** | Fallback still happens, but only if the company has explicitly opted in, with a configurable spend/request cap on fallback usage specifically, and a notification to the company admin when it occurs | Needs new schema (a `byo_fallback_approved` flag + a cap counter) and a notification path — more than a trivial fix |
| **C. Keep current behavior** | No change | Zero cost, but the risk above stands as documented |

**Recommendation:** Option A is the smallest, safest change and directly matches this phase's own mandatory rule ("prevent automatic fallback to a paid provider unless that provider and its spending limit have been explicitly approved") — a BYO user who configured their own provider has not approved the platform's provider as a fallback, so silently using it violates that rule as written today. **This is flagged for your approval, not implemented in this pass**, since it changes user-facing error behavior for an edge case (BYO outages) that wasn't in scope for a "fix only clearly safe defects" pass without a decision.

## 6. Configurable budgets and alerts — NOT implemented

There is no spend/budget concept anywhere in the schema — confirmed by searching for `spendingLimit`/`budget`/`monthlyLimit`/`costLimit` across `apps/api/src`: zero matches. The only numeric controls that exist are the per-role **request-count** limits in §1 (requests/day, requests/minute), not a dollar or token budget.

**What exists that a budget feature could be built on:**
- `ai_usage_log` already has `input_tokens`/`output_tokens` per request (now actually populated — see §7's fix), which is the raw data a cost estimate needs.
- Provider list pricing is public and known (e.g., per-million-token input/output rates vary by provider and model) but **no historical spend has ever been computed from this data**, because the tokens were never captured until this phase. There is currently zero actual measured spend to report — only a go-forward capability to start measuring it.

**Proposed, not built:** a per-company monthly token/cost cap, computed by summing `ai_usage_log.input_tokens`/`output_tokens` × that provider's public per-token rate, with an admin-configurable threshold and an email/in-app alert at e.g. 80%/100% of it. This is a reporting-and-alerting feature, not a hard cutoff, unless you want it to double as one (a hard cutoff needs careful design — a company hitting a cost cap mid-shift shouldn't lose assistant access without warning). **Needs product approval before building** — no cost to running it (pure arithmetic over existing log rows), but it is new scope, not a bug fix.

## 7. Token-cost tracking fix — IMPLEMENTED AND VERIFIED this phase

**Confirmed defect (now fixed):** `ai_usage_log.input_tokens`/`output_tokens` have existed in the schema since migration 062 and every provider adapter already returns real counts via `GenerateResponseResult.inputTokens`/`outputTokens` — but `AiService.generate()` and `generateDraft()` discarded those fields before they reached `usage.log()`, so **every row in this table had `NULL` token counts since the column was added**, silently defeating the whole point of logging them.

**Fix applied:** `generate()` and `generateDraft()` now thread `inputTokens`/`outputTokens` through to `ask()`'s `usage.log()` call, without changing the public `AskAssistantResult` response shape the frontend consumes. Verified:
- `npx tsc --noEmit` — clean.
- `npx jest ai.service` — 13/13 pass, including a new regression test (`'passes the provider-reported token counts through to usage.log()'`) that locks this in.
- Full API suite — 594/594 pass, 60/60 suites, no regressions.

**Practical effect:** from this deploy forward, `ai_usage_log` carries real, per-request token counts, which is the prerequisite for §6's proposed cost-budgeting feature and for any future per-company/per-provider cost reporting. **No historical cost data exists before this fix** — any cost report built on this table can only cover usage from this point forward; do not back-fill or estimate pre-fix spend, since the raw data to do so honestly does not exist.

## 8. AI never approves, closes, or overrides authorization — VERIFIED by design

Confirmed structurally, not just by policy statement: `AiService`'s tool router (`ai-tools.service.ts`) only exposes **read** tools (`getProjectSummary`, `getOpenRfis`, etc.) and **draft** tools (`createRfiDraft`, `createIssueDraft`, `createSnagDraft`) — every draft tool returns a structured suggestion object (`{ tool, category, data }`) that the frontend presents for the human user to review and explicitly submit through the normal RFI/Issue/Snag creation endpoints, which carry their own full `RolesGuard`/`ProjectPermissionGuard`/`SiteRoleRestrictionGuard` chain independent of the AI. The AI itself has no write path, no approval endpoint, and no RFI-closing capability anywhere in its tool surface. This remains true after this phase's changes — nothing in this pass touched that boundary.

## 9. Summary of new recurring costs introduced by this phase

**None.** The token-tracking fix (§7) uses data already being generated by provider calls that were already happening — it adds zero new API calls, zero new infrastructure, and zero new spend. No new paid API, subscription, or service was added anywhere in this phase. The proposals in §2–§6 (caching, RAG, model tiering, budget alerting) are explicitly **not built** and would each need separate cost estimation and approval before any implementation.
