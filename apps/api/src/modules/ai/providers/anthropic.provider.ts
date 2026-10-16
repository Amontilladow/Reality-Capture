import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider, GenerateResponseInput, GenerateResponseResult,
  ClassifyRequestResult, AIProviderModelInfo, ValidateConnectionResult,
  ToolDefinition, SelectToolsResult,
} from './ai-provider.interface';

@Injectable()
export class AnthropicProvider implements AIProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateResponse({ systemPrompt, messages, maxTokens = 1024 }: GenerateResponseInput): Promise<GenerateResponseResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      text,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  }

  async *streamResponse(input: GenerateResponseInput): AsyncIterable<string> {
    const { text } = await this.generateResponse(input);
    yield text;
  }

  async classifyRequest(question: string): Promise<ClassifyRequestResult> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: `Answer with exactly one word, ALLOW or BLOCK: is this question about a construction/engineering project management platform's own data (projects, RFIs, issues, snagging, risk, progress, documents)? Question: "${question}"`,
        }],
      });
      const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      const answer = (block?.text ?? '').trim().toUpperCase();
      return { inDomain: answer.startsWith('ALLOW') };
    } catch (err) {
      this.logger.warn(`classifyRequest failed, defaulting to blocked: ${err instanceof Error ? err.message : String(err)}`);
      return { inDomain: false, reason: 'classification_unavailable' };
    }
  }

  async selectTools(question: string, tools: ToolDefinition[]): Promise<SelectToolsResult> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: { type: 'object' as const, properties: {} },
        })),
        messages: [{
          role: 'user',
          content: `Decide which of the available tools are needed to answer this question about THIS construction project. Call every tool that could help, even if you are not fully sure -- it is fine to call one that turns out not to be needed. If none apply, do not call any tool. Question: "${question}"`,
        }],
      });
      const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      return { toolCalls: calls.map((c) => ({ name: c.name })) };
    } catch (err) {
      this.logger.warn(`selectTools failed: ${err instanceof Error ? err.message : String(err)}`);
      return { toolCalls: [], failed: true };
    }
  }

  getModelInfo(): AIProviderModelInfo {
    return { provider: 'anthropic', model: this.model };
  }

  async validateConnection(): Promise<ValidateConnectionResult> {
    try {
      await this.client.messages.create({ model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
