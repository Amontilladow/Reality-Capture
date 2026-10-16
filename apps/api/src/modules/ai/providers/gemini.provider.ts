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

  constructor(private readonly apiKey: string, private readonly model: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generateResponse({ systemPrompt, messages, maxTokens = 1024 }: GenerateResponseInput): Promise<GenerateResponseResult> {
    const model = this.client.getGenerativeModel({ model: this.model, systemInstruction: systemPrompt });
    // Gemini's chat history excludes the final turn (it's the prompt passed
    // to sendMessage), and requires the history to start with a 'user' turn
    // -- true here since the domain guard only ever lets a user-initiated
    // question through.
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
      const model = this.client.getGenerativeModel({
        model: this.model,
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
      const calls = result.response.functionCalls() ?? [];
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
