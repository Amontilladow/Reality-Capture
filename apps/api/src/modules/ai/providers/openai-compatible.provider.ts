import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  AIProvider, GenerateResponseInput, GenerateResponseResult,
  ClassifyRequestResult, AIProviderModelInfo, ValidateConnectionResult,
} from './ai-provider.interface';

// One implementation backs three provider names (OpenAI itself, a
// self-hosted/enterprise "custom_openai_compatible" endpoint, and Ollama)
// because all three speak the same Chat Completions API shape -- Ollama
// exposes an OpenAI-compatible /v1 endpoint, and "custom_openai_compatible"
// is that shape by definition. Only the base URL and whether an API key is
// required differ, both passed in by the caller (ProviderFactory for
// RealityCapture's own OpenAI config, or ai-connections for a user's BYO
// connection). This keeps CTO spec section 31/32's "self-hosted/enterprise
// endpoint" and "Ollama" future providers honestly supported today, not
// just structurally possible.
@Injectable()
export class OpenAICompatibleProvider implements AIProvider {
  private readonly logger = new Logger(OpenAICompatibleProvider.name);
  private readonly client: OpenAI;

  constructor(
    apiKey: string | undefined,
    private readonly model: string,
    private readonly providerLabel: string,
    baseURL?: string,
  ) {
    // Ollama commonly needs no API key at all (local, unauthenticated) --
    // the SDK requires a non-empty string, so this is a harmless placeholder
    // never actually checked by a local Ollama server.
    this.client = new OpenAI({ apiKey: apiKey || 'not-required', baseURL });
  }

  async generateResponse({ systemPrompt, messages, maxTokens = 1024 }: GenerateResponseInput): Promise<GenerateResponseResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    return {
      text: response.choices[0]?.message?.content ?? '',
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    };
  }

  async *streamResponse(input: GenerateResponseInput): AsyncIterable<string> {
    const { text } = await this.generateResponse(input);
    yield text;
  }

  async classifyRequest(question: string): Promise<ClassifyRequestResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: `Answer with exactly one word, ALLOW or BLOCK: is this question about a construction/engineering project management platform's own data (projects, RFIs, issues, snagging, risk, progress, documents)? Question: "${question}"`,
        }],
      });
      const answer = (response.choices[0]?.message?.content ?? '').trim().toUpperCase();
      return { inDomain: answer.startsWith('ALLOW') };
    } catch (err) {
      this.logger.warn(`classifyRequest failed, defaulting to blocked: ${err instanceof Error ? err.message : String(err)}`);
      return { inDomain: false, reason: 'classification_unavailable' };
    }
  }

  getModelInfo(): AIProviderModelInfo {
    return { provider: this.providerLabel, model: this.model };
  }

  async validateConnection(): Promise<ValidateConnectionResult> {
    try {
      await this.client.chat.completions.create({ model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
