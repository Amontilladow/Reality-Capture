import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type {
  AIProvider, GenerateResponseInput, GenerateResponseResult,
  ClassifyRequestResult, AIProviderModelInfo, ValidateConnectionResult,
  ToolDefinition, SelectToolsResult,
} from './ai-provider.interface';

@Injectable()
export class GeminiProvider implements AIProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly client: GoogleGenerativeAI;
  // [primary, ...fallbacks], deduped -- see ai.config.ts's fallbackModels
  // comment for why this exists (gemini-3.5-flash-lite itself hit a 503
  // "experiencing high demand" in production, the third model tier to do so
  // in one day).
  private readonly modelChain: string[];

  constructor(private readonly apiKey: string, private readonly model: string, fallbackModels: string[] = []) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelChain = Array.from(new Set([model, ...fallbackModels]));
  }

  // "Experiencing high demand" / overloaded / a transient 5xx is worth
  // retrying against a different model (a different one is very likely a
  // different capacity pool). Anything else -- a bad API key, a malformed
  // request, a genuinely retired/unknown model name -- would fail on every
  // model in the chain identically, so there's no point burning the extra
  // round trips; fail immediately instead.
  private isRetriableError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /\b5\d{2}\b|\b429\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(message);
  }

  // Tries each model in modelChain, in order, until one succeeds. Only
  // advances to the next model on a retriable error (see
  // isRetriableError) -- any other error is rethrown immediately. If every
  // model in the chain fails, rethrows the last error, same as a single-
  // model call would have -- callers (AiService) don't need to know
  // fallback happened at all, only whether it ultimately worked.
  private async withModelFallback<T>(attempt: (modelName: string) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (const modelName of this.modelChain) {
      try {
        const result = await attempt(modelName);
        if (modelName !== this.model) {
          this.logger.warn(`Primary model ${this.model} unavailable, succeeded on fallback ${modelName}`);
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (!this.isRetriableError(err)) throw err;
        this.logger.warn(`Model ${modelName} failed with a retriable error, trying next in chain: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw lastErr;
  }

  async generateResponse({ systemPrompt, messages, maxTokens = 1024 }: GenerateResponseInput): Promise<GenerateResponseResult> {
    return this.withModelFallback(async (modelName) => {
      const model = this.client.getGenerativeModel({ model: modelName, systemInstruction: systemPrompt });
      // Gemini's chat history excludes the final turn (it's the prompt
      // passed to sendMessage), and requires the history to start with a
      // 'user' turn -- true here since the domain guard only ever lets a
      // user-initiated question through.
      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const last = messages[messages.length - 1];
      const chat = model.startChat({ history, generationConfig: { maxOutputTokens: maxTokens } });
      const result = await chat.sendMessage(last.content);
      const response = result.response;
      return {
        text: response.text(),
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      };
    });
  }

  async *streamResponse(input: GenerateResponseInput): AsyncIterable<string> {
    const { text } = await this.generateResponse(input);
    yield text;
  }

  async classifyRequest(question: string): Promise<ClassifyRequestResult> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      const result = await model.generateContent(
        `Answer with exactly one word, ALLOW or BLOCK: is this question about a construction/engineering project management platform's own data (projects, RFIs, issues, snagging, risk, progress, documents)? Question: "${question}"`,
      );
      const answer = result.response.text().trim().toUpperCase();
      return { inDomain: answer.startsWith('ALLOW') };
    } catch (err) {
      this.logger.warn(`classifyRequest failed, defaulting to blocked: ${err instanceof Error ? err.message : String(err)}`);
      return { inDomain: false, reason: 'classification_unavailable' };
    }
  }

  async selectTools(question: string, tools: ToolDefinition[]): Promise<SelectToolsResult> {
    try {
      const calls = await this.withModelFallback(async (modelName) => {
        const model = this.client.getGenerativeModel({
          model: modelName,
          tools: [{
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: { type: SchemaType.OBJECT, properties: {} },
            })),
          }],
        });
        const result = await model.generateContent(
          `Decide which of the available functions are needed to answer this question about THIS construction project. Call every function that could help, even if you are not fully sure -- it is fine to call one that turns out not to be needed. If none apply, do not call any function. Question: "${question}"`,
        );
        return result.response.functionCalls() ?? [];
      });
      return { toolCalls: calls.map((c) => ({ name: c.name })) };
    } catch (err) {
      this.logger.warn(`selectTools failed: ${err instanceof Error ? err.message : String(err)}`);
      return { toolCalls: [], failed: true };
    }
  }

  getModelInfo(): AIProviderModelInfo {
    return { provider: 'gemini', model: this.model };
  }

  async validateConnection(): Promise<ValidateConnectionResult> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      await model.generateContent('ping');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
