# EngineeringOS — AI Provider Strategy

**Phase 7: Continuous Improvement, AI Optimization & Product Growth**
Scope: how RealityCapture's own AI ("Mode A") and each company's optional Bring-Your-Own AI ("Mode B") are wired together today, verified against the actual code (`apps/api/src/modules/ai/`), not assumed from prior-phase documentation.

---

## 1. Current architecture (verified)

```
AiService.ask()/generateDraft()
        │
        ├─ DomainGuardService.evaluate()   ← zero-cost, pre-provider keyword filter (see AI_EVALUATION_FRAMEWORK.md)
        ├─ AiUsageService.checkAndReserve() ← Redis daily+per-minute quota, see AI_USAGE_AND_COST_POLICY.md
        ├─ resolveProvider(user)
        │     ├─ AiConnectionsService.getProviderForUser() → user's own BYO provider, if connected
        │     └─ else ProviderFactory.getProvider()         → RealityCapture's own, shared provider
        └─ provider.generateResponse(...) → AIProvider interface (ai-provider.interface.ts)
```

Every provider — RealityCapture's own and every BYO option — implements one interface:

```ts
interface AIProvider {
  generateResponse(input): Promise<{ text; inputTokens?; outputTokens? }>;
  streamResponse(input): AsyncIterable<string>;
  classifyRequest(question): Promise<{ inDomain; reason? }>;
  getModelInfo(): { provider; model };
  validateConnection(): Promise<{ ok; error? }>;
}
```

No code outside `modules/ai/providers/*` imports a vendor SDK directly. This seam is real and has held up across two prior build phases (AI rebuild, CTO spec) that each added a new provider without touching `AiService`, the domain guard, the tool router, or the frontend — confirmed by reading `provider.factory.ts`, which only grew a new `case` per adapter.

## 2. Providers implemented today

| Provider | Adapter file | Used for |
|---|---|---|
| Google Gemini | `gemini.provider.ts` | Mode A (RealityCapture's own), if `GEMINI_API_KEY` set |
| Anthropic Claude | `anthropic.provider.ts` | Mode A, if `ANTHROPIC_API_KEY` set (and today's actual default — see §3) |
| OpenAI | `openai-compatible.provider.ts` (`'openai'` variant) | Mode A or Mode B |
| Any OpenAI-compatible endpoint | `openai-compatible.provider.ts` (`'custom_openai_compatible'` variant) | Mode B only — lets a company point at their own hosted/self-managed endpoint |
| Ollama (local models) | `openai-compatible.provider.ts` (`'ollama'` variant, default `http://localhost:11434/v1`) | Mode B only |

Mode A resolution (`ProviderFactory.resolve()`, `provider.factory.ts:73-93`): `AI_PROVIDER=gemini\|anthropic\|openai` forces that adapter; unset/`auto` tries Gemini key, then Anthropic key, then OpenAI key, in that order, and **fails closed at boot** (throws, logged as a warning, not a crash — `onModuleInit()` deliberately doesn't take the rest of the API down over it) if none are set. `apps/api/src/config/ai.config.ts:56-57` shows the currently-configured default model is `claude-sonnet-4-6` for the Anthropic branch — whichever branch actually resolves in a given deployment depends on which API keys are set in that environment's secrets, which this document cannot read and does not guess.

## 3. Switching providers — cost and effort, honestly

- **Switching which key/model RealityCapture's own Mode A uses** (e.g. Gemini → Anthropic, or changing `ANTHROPIC_MODEL`): zero code changes. Set the env var, redeploy. This is the cheapest possible provider change and the one most worth knowing is already available.
- **Adding a wholly new vendor** (e.g. a provider not in the table above): one new class implementing `AIProvider`, one new `case` in `ProviderFactory.resolve()` and `buildFromCredentials()`. Based on the size of the existing adapters (each is a single-file HTTP/SDK wrapper, no business logic), this is a small, contained change — a day or less of engineering time for a competent adapter, not a redesign.
- **No code changes needed** to support a company bringing their own: the `custom_openai_compatible` and `ollama` variants already exist and accept any compatible endpoint, including a company's privately-hosted model. This is real flexibility already shipped, not a roadmap item.

## 4. Known limitation: streaming is not real yet

`AIProvider.streamResponse()` is declared and every adapter implements it, but as "a single-chunk wrapper over `generateResponse()`" (see the interface's own comment, `ai-provider.interface.ts:41-48`) — the full response is generated, then yielded once. The frontend (`AssistantPage`) doesn't consume token-level streaming today either. This was an explicit, documented scope decision in the original AI rebuild, not a regression, and is unchanged in this phase — real streaming needs an SSE/WebSocket round trip that is out of this phase's scope to add without a stated product need (no evidence users are blocked by response latency today — see PERFORMANCE_AND_INFRASTRUCTURE_OPTIMIZATION.md for the latency numbers that do exist).

## 5. What this document does NOT cover

Budget/spend governance, the BYO-to-platform-fallback risk, and quota enforcement are covered in **AI_USAGE_AND_COST_POLICY.md**. Correctness/safety/reliability testing is covered in **AI_EVALUATION_FRAMEWORK.md**. Nothing here recommends adding a new paid provider, service, or subscription — the finding is that the existing abstraction already supports provider flexibility at near-zero marginal cost; no new spend is proposed.
