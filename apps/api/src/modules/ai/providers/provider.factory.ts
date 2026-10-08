import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './gemini.provider';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import type { AIProvider } from './ai-provider.interface';
import type { ByoAiProvider } from '../../ai-connections/dto/connect-ai-provider.dto';

// The ONLY place that decides which concrete AIProvider the rest of the
// app talks to. AI_PROVIDER=gemini|anthropic|openai forces that adapter;
// unset or 'auto' picks gemini if GEMINI_API_KEY is set, else anthropic if
// ANTHROPIC_API_KEY is set, else openai if OPENAI_API_KEY is set, else
// fails closed at startup rather than booting with a gateway that can
// never actually answer anything. This is RealityCapture's OWN provider
// (spec Mode A) -- a single, cached, app-wide instance.
//
// For Mode B (BYO AI), use buildFromCredentials() instead: a stateless
// constructor for a one-off provider instance from a user's own stored
// connection (modules/ai-connections), never cached, since different users
// can have different providers/credentials simultaneously.
//
// Switching RealityCapture's own provider later (spec section 20/31) means
// either: (a) set AI_PROVIDER + the new key and redeploy -- zero code
// changes for gemini/anthropic/openai, since adapters already exist; or
// (b) for a genuinely new vendor, write one new class implementing
// AIProvider and add one more branch to both resolve() and
// buildFromCredentials(). Nothing in AiService, the domain guard, the tool
// router, or the frontend changes either way.
@Injectable()
export class ProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(ProviderFactory.name);
  private provider: AIProvider | null = null;

  constructor(private readonly config: ConfigService) {}

  // Deliberately non-fatal: an unconfigured/misconfigured AI provider is a
  // real gap, but it shouldn't take the rest of the app down with it (every
  // other module -- auth, projects, issues, RFIs, BIM, etc. -- has nothing
  // to do with AI and would otherwise fail to boot too). getProvider()
  // below still fails closed, just lazily -- the first AI request after a
  // bad config gets a clear error instead of the whole API never starting.
  onModuleInit() {
    try {
      this.provider = this.resolve();
      const info = this.provider.getModelInfo();
      this.logger.log(`AI provider active: ${info.provider} (${info.model})`);
    } catch (err) {
      this.logger.warn(
        `AI provider not available at startup -- AI requests will fail until this is fixed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getProvider(): AIProvider {
    if (!this.provider) this.provider = this.resolve();
    return this.provider;
  }

  // Builds a standalone provider instance from arbitrary credentials --
  // used for BYO AI (a user's own connection) and for validating a
  // connection before it's saved. Deliberately does not touch/replace
  // this.provider (RealityCapture's own, shared instance).
  buildFromCredentials(provider: ByoAiProvider, model: string, apiKey: string | undefined, baseUrl?: string): AIProvider {
    switch (provider) {
      case 'gemini': return new GeminiProvider(apiKey!, model);
      case 'anthropic': return new AnthropicProvider(apiKey!, model);
      case 'openai': return new OpenAICompatibleProvider(apiKey, model, 'openai');
      case 'custom_openai_compatible': return new OpenAICompatibleProvider(apiKey, model, 'custom_openai_compatible', baseUrl);
      case 'ollama': return new OpenAICompatibleProvider(apiKey, model, 'ollama', baseUrl || 'http://localhost:11434/v1');
    }
  }

  private resolve(): AIProvider {
    const requested = this.config.get<string>('ai.provider') ?? 'auto';
    const geminiKey = this.config.get<string>('ai.gemini.apiKey');
    const anthropicKey = this.config.get<string>('ai.anthropic.apiKey');
    const openaiKey = this.config.get<string>('ai.openai.apiKey');

    if (requested === 'gemini') return this.buildGemini(geminiKey);
    if (requested === 'anthropic') return this.buildAnthropic(anthropicKey);
    if (requested === 'openai') return this.buildOpenAI(openaiKey);

    if (requested !== 'auto') {
      throw new Error(`Unknown AI_PROVIDER "${requested}" -- expected "gemini", "anthropic", "openai", or "auto".`);
    }

    if (geminiKey) return this.buildGemini(geminiKey);
    if (anthropicKey) return this.buildAnthropic(anthropicKey);
    if (openaiKey) return this.buildOpenAI(openaiKey);
    throw new Error(
      'No AI provider configured -- set GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY (and optionally AI_PROVIDER to force one).',
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

  private buildOpenAI(apiKey: string | undefined): AIProvider {
    if (!apiKey) throw new Error('AI_PROVIDER=openai but OPENAI_API_KEY is not set.');
    return new OpenAICompatibleProvider(apiKey, this.config.get<string>('ai.openai.model')!, 'openai');
  }
}
