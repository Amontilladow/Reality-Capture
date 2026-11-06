# EngineeringOS AI provider strategy

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

Every provider, RealityCapture's own and every BYO option, implements one interface:

```ts
interface AIProvider {
  generateResponse(input): Promise<{ text; inputTokens?; outputTokens? }>;
  streamResponse(input): AsyncIterable<string>;
  classifyRequest(question): Promise<{ inDomain; reason? }>;
  getModelInfo(): { provider; model };
  validateConnection(): Promise<{ ok; error? }>;
}
```

No code outside `modules/ai/providers/*` imports a vendor SDK directly. Two earlier build phases (AI rebuild, CTO spec) each added a provider without touching `AiService`, the domain guard, the tool router, or the frontend. `provider.factory.ts` confirms this: it only grew a new `case` per adapter.

## 2. Providers implemented today

| Provider | Adapter file | Used for |
|---|---|---|
| Google Gemini | `gemini.provider.ts` | Mode A (RealityCapture's own), if `GEMINI_API_KEY` set |
| Anthropic Claude | `anthropic.provider.ts` | Mode A, if `ANTHROPIC_API_KEY` set (and today's actual default; see §3) |
| OpenAI | `openai-compatible.provider.ts` (`'openai'` variant) | Mode A or Mode B |
| Any OpenAI-compatible endpoint | `openai-compatible.provider.ts` (`'custom_openai_compatible'` variant) | Mode B only. Lets a company point at their own hosted/self-managed endpoint |
| Ollama (local models) | `openai-compatible.provider.ts` (`'ollama'` variant, default `http://localhost:11434/v1`) | Mode B only |

Mode A resolution (`ProviderFactory.resolve()`, `provider.factory.ts:73-93`): `AI_PROVIDER=gemini\|anthropic\|openai` forces that adapter. Unset or `auto` tries the Gemini key, then the Anthropic key, then the OpenAI key, and **fails closed at boot** if none are set. It throws and logs a warning rather than crashing; `onModuleInit()` deliberately doesn't take the rest of the API down over it. `apps/api/src/config/ai.config.ts:56-57` sets the default model for the Anthropic branch to `claude-sonnet-4-6`. Which branch resolves in a given deployment depends on which API keys are set in that environment's secrets, which this document cannot read and does not guess.

## 3. Switching providers: cost and effort

- **Switching which key/model RealityCapture's own Mode A uses** (e.g. Gemini → Anthropic, or changing `ANTHROPIC_MODEL`): zero code changes. Set the env var and redeploy. This is the cheapest provider change, and it is already available.
- **Adding a wholly new vendor** (e.g. a provider not in the table above): one new class implementing `AIProvider`, plus one new `case` in `ProviderFactory.resolve()` and `buildFromCredentials()`. The existing adapters are each a single-file HTTP/SDK wrapper with no business logic, so this is a small change: about a day of engineering time, not a redesign.
- **No code changes needed** for a company to bring their own provider: the `custom_openai_compatible` and `ollama` variants already accept any compatible endpoint, including a company's privately hosted model. This already ships today.

## 4. Known limitation: streaming is not real yet

`AIProvider.streamResponse()` is declared and every adapter implements it, but only as "a single-chunk wrapper over `generateResponse()`" (see the interface's own comment, `ai-provider.interface.ts:41-48`). The full response is generated, then yielded once. The frontend (`AssistantPage`) doesn't consume token-level streaming either. Leaving streaming out was a documented scope decision in the original AI rebuild, not a regression, and this phase doesn't change it. Real streaming needs an SSE/WebSocket round trip, which is out of scope without a stated product need. There is no evidence that response latency blocks users today; PERFORMANCE_AND_INFRASTRUCTURE_OPTIMIZATION.md has the latency numbers that do exist.

## 5. What this document does NOT cover

Budget/spend governance, the BYO-to-platform-fallback risk, and quota enforcement are covered in **AI_USAGE_AND_COST_POLICY.md**. Correctness/safety/reliability testing is covered in **AI_EVALUATION_FRAMEWORK.md**. This document proposes no new paid provider, service, subscription or spend: the existing abstraction already supports switching providers at near-zero marginal cost.
