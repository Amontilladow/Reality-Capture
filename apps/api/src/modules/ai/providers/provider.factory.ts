import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './gemini.provider';
import { AnthropicProvider } from './anthropic.provider';
import type { AIProvider } from './ai-provider.interface';

// The ONLY place that decides which concrete AIProvider the rest of the
// app talks to. AI_PROVIDER=gemini|anthropic forces that adapter; unset or
// 'auto' picks gemini if GEMINI_API_KEY is set, else anthropic if
// ANTHROPIC_API_KEY is set, else fails closed at startup rather than
// booting with a gateway that can never actually answer anything.
//
// Switching provider later (spec section 20) means either: (a) set
// AI_PROVIDER + the new key and redeploy -- zero code changes if it's
// gemini or anthropic, since both adapters already exist; or (b) for a
// genuinely new vendor (OpenAI, Ollama, self-hosted), write one new class
// implementing AIProvider and add one more branch here. Nothing in
// AiService, the domain guard, the tool router, or the frontend changes
// either way.
@Injectable()
export class ProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(ProviderFactory.name);
  private provider: AIProvider | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.provider = this.resolve();
    const info = this.provider.getModelInfo();
    this.logger.log(`AI provider active: ${info.provider} (${info.model})`);
  }

  getProvider(): AIProvider {
    if (!this.provider) this.provider = this.resolve();
    return this.provider;
  }

  private resolve(): AIProvider {
    const requested = this.config.get<string>('ai.provider') ?? 'auto';
    const geminiKey = this.config.get<string>('ai.gemini.apiKey');
    const anthropicKey = this.config.get<string>('ai.anthropic.apiKey');

    if (requested === 'gemini') return this.buildGemini(geminiKey);
    if (requested === 'anthropic') return this.buildAnthropic(anthropicKey);

    if (requested !== 'auto') {
      throw new Error(`Unknown AI_PROVIDER "${requested}" -- expected "gemini", "anthropic", or "auto".`);
    }

    if (geminiKey) return this.buildGemini(geminiKey);
    if (anthropicKey) return this.buildAnthropic(anthropicKey);
    throw new Error(
      'No AI provider configured -- set GEMINI_API_KEY or ANTHROPIC_API_KEY (and optionally AI_PROVIDER to force one).',
    );
  }

  private buildGemini(apiKey: string | undefined): AIProvider {
    if (!apiKey) throw new Error('AI_PROVIDER=gemini but GEMINI_API_KEY is not set.');
    return new GeminiProvider(apiKey, this.config.get<string>('ai.gemini.model')!);
  }

  private buildAnthropic(apiKey: string | undefined): AIProvider {
    if (!apiKey) throw new Error('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.');
    return new AnthropicProvider(apiKey, this.config.get<string>('ai.anthropic.model')!);
  }
}
