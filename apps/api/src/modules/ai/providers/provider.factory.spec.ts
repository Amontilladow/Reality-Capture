const mockSendMessage = jest.fn();
const mockStartChat = jest.fn().mockReturnValue({ sendMessage: mockSendMessage });
const mockGetGenerativeModel = jest.fn().mockReturnValue({ startChat: mockStartChat });

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel })),
  SchemaType: { OBJECT: 'OBJECT' },
}));

import type { ConfigService } from '@nestjs/config';
import { ProviderFactory } from './provider.factory';

function makeConfig(values: Record<string, unknown>): ConfigService {
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

describe('ProviderFactory.resolve (RealityCapture\'s own provider, auto mode)', () => {
  it('picks gemini when GEMINI_API_KEY is set, regardless of the others', () => {
    const factory = new ProviderFactory(makeConfig({
      'ai.provider': 'auto', 'ai.gemini.apiKey': 'g-key', 'ai.gemini.model': 'gemini-2.0-flash',
      'ai.anthropic.apiKey': 'a-key', 'ai.openai.apiKey': 'o-key',
    }));
    expect(factory.getProvider().getModelInfo()).toEqual({ provider: 'gemini', model: 'gemini-2.0-flash' });
  });

  it('falls back to anthropic when no gemini key is set', () => {
    const factory = new ProviderFactory(makeConfig({
      'ai.provider': 'auto', 'ai.anthropic.apiKey': 'a-key', 'ai.anthropic.model': 'claude-sonnet-4-6',
    }));
    expect(factory.getProvider().getModelInfo()).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('falls back to openai when neither gemini nor anthropic keys are set', () => {
    const factory = new ProviderFactory(makeConfig({
      'ai.provider': 'auto', 'ai.openai.apiKey': 'o-key', 'ai.openai.model': 'gpt-4o',
    }));
    expect(factory.getProvider().getModelInfo()).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('fails closed at startup when no provider key is configured at all', () => {
    const factory = new ProviderFactory(makeConfig({ 'ai.provider': 'auto' }));
    expect(() => factory.getProvider()).toThrow(/No AI provider configured/);
  });

  it('onModuleInit does not throw when unconfigured -- the rest of the app must still boot', () => {
    const factory = new ProviderFactory(makeConfig({ 'ai.provider': 'auto' }));
    expect(() => factory.onModuleInit()).not.toThrow();
    // Still fails closed, just lazily -- the first real AI request surfaces the error.
    expect(() => factory.getProvider()).toThrow(/No AI provider configured/);
  });

  it('an explicit AI_PROVIDER is forced even when a higher-priority key is also present', () => {
    const factory = new ProviderFactory(makeConfig({
      'ai.provider': 'anthropic',
      'ai.gemini.apiKey': 'g-key', // would otherwise win under auto
      'ai.anthropic.apiKey': 'a-key', 'ai.anthropic.model': 'claude-sonnet-4-6',
    }));
    expect(factory.getProvider().getModelInfo()).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('an explicit AI_PROVIDER with no matching key fails closed, not silently falling back', () => {
    const factory = new ProviderFactory(makeConfig({ 'ai.provider': 'gemini' }));
    expect(() => factory.getProvider()).toThrow(/GEMINI_API_KEY is not set/);
  });

  it('rejects an unknown AI_PROVIDER value', () => {
    const factory = new ProviderFactory(makeConfig({ 'ai.provider': 'not-a-real-provider' }));
    expect(() => factory.getProvider()).toThrow(/Unknown AI_PROVIDER/);
  });

  // A third-party OpenAI-compatible gateway, forced explicitly (never part
  // of auto-detection, same as the BYO-only providers) since it needs both
  // a key and a base URL, not just a key.
  describe('AI_PROVIDER=custom_openai_compatible', () => {
    it('builds a provider pointed at the configured gateway, not api.openai.com', () => {
      const factory = new ProviderFactory(makeConfig({
        'ai.provider': 'custom_openai_compatible',
        'ai.customOpenAICompatible.apiKey': 'gateway-key',
        'ai.customOpenAICompatible.baseUrl': 'https://api.example-gateway.com/v1',
        'ai.customOpenAICompatible.model': 'gpt-6-luna',
      }));
      expect(factory.getProvider().getModelInfo()).toEqual({ provider: 'custom_openai_compatible', model: 'gpt-6-luna' });
    });

    it('fails closed when the API key is missing', () => {
      const factory = new ProviderFactory(makeConfig({
        'ai.provider': 'custom_openai_compatible',
        'ai.customOpenAICompatible.baseUrl': 'https://api.example-gateway.com/v1',
      }));
      expect(() => factory.getProvider()).toThrow(/CUSTOM_OPENAI_API_KEY is not set/);
    });

    it('fails closed when the base URL is missing -- a key alone would silently hit api.openai.com instead', () => {
      const factory = new ProviderFactory(makeConfig({
        'ai.provider': 'custom_openai_compatible',
        'ai.customOpenAICompatible.apiKey': 'gateway-key',
      }));
      expect(() => factory.getProvider()).toThrow(/CUSTOM_OPENAI_BASE_URL is not set/);
    });

    it('is never selected by auto-detection, only by an explicit AI_PROVIDER', () => {
      const factory = new ProviderFactory(makeConfig({
        'ai.provider': 'auto',
        'ai.customOpenAICompatible.apiKey': 'gateway-key',
        'ai.customOpenAICompatible.baseUrl': 'https://api.example-gateway.com/v1',
      }));
      expect(() => factory.getProvider()).toThrow(/No AI provider configured/);
    });
  });

  it('caches the resolved provider -- resolve only runs once', () => {
    const config = makeConfig({ 'ai.provider': 'auto', 'ai.gemini.apiKey': 'g-key', 'ai.gemini.model': 'gemini-2.0-flash' });
    const factory = new ProviderFactory(config);
    const first = factory.getProvider();
    const second = factory.getProvider();
    expect(first).toBe(second);
  });
});

describe('ProviderFactory.buildFromCredentials (BYO AI, Mode B)', () => {
  const factory = new ProviderFactory(makeConfig({}));

  it('dispatches each BYO provider identity to its correct adapter', () => {
    expect(factory.buildFromCredentials('gemini', 'gemini-2.0-flash', 'key').getModelInfo()).toEqual({ provider: 'gemini', model: 'gemini-2.0-flash' });
    expect(factory.buildFromCredentials('anthropic', 'claude-sonnet-4-6', 'key').getModelInfo()).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(factory.buildFromCredentials('openai', 'gpt-4o', 'key').getModelInfo()).toEqual({ provider: 'openai', model: 'gpt-4o' });
    expect(factory.buildFromCredentials('custom_openai_compatible', 'llama3', 'key', 'https://example.com/v1').getModelInfo())
      .toEqual({ provider: 'custom_openai_compatible', model: 'llama3' });
    expect(factory.buildFromCredentials('ollama', 'llama3', undefined).getModelInfo()).toEqual({ provider: 'ollama', model: 'llama3' });
  });

  it('never caches or replaces RealityCapture\'s own shared provider instance', () => {
    const configuredFactory = new ProviderFactory(makeConfig({
      'ai.provider': 'auto', 'ai.gemini.apiKey': 'g-key', 'ai.gemini.model': 'gemini-2.0-flash',
    }));
    const rcProvider = configuredFactory.getProvider();
    configuredFactory.buildFromCredentials('openai', 'gpt-4o', 'user-key');
    expect(configuredFactory.getProvider()).toBe(rcProvider);
  });
});

// Owner-reported outage: gemini-3.5-flash-lite itself returned a 503 "high
// demand" error in production (the third Gemini model tier to do so in one
// day). RealityCapture's own Gemini provider now retries against
// ai.gemini.fallbackModels before failing; a BYO user's own Gemini
// connection deliberately does not get this -- they configured one
// specific model and should get exactly that, or a clear failure.
describe('ProviderFactory.buildGemini -- model fallback wiring', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockGetGenerativeModel.mockClear();
  });

  it("passes ai.gemini.fallbackModels through, so a 503 on the primary retries the configured fallback", async () => {
    mockSendMessage
      .mockRejectedValueOnce(new Error('[503 Service Unavailable] This model is currently experiencing high demand.'))
      .mockResolvedValueOnce({ response: { text: () => 'answer from fallback', usageMetadata: {} } });
    const factory = new ProviderFactory(makeConfig({
      'ai.provider': 'gemini', 'ai.gemini.apiKey': 'g-key', 'ai.gemini.model': 'gemini-3.5-flash-lite',
      'ai.gemini.fallbackModels': ['gemini-3.1-flash-lite'],
    }));

    const result = await factory.getProvider().generateResponse({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] });

    expect(result.text).toBe('answer from fallback');
    expect(mockGetGenerativeModel.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  });

  it('works with no fallbackModels configured at all (defaults to [])', async () => {
    mockSendMessage.mockResolvedValue({ response: { text: () => 'answer', usageMetadata: {} } });
    const factory = new ProviderFactory(makeConfig({
      'ai.provider': 'gemini', 'ai.gemini.apiKey': 'g-key', 'ai.gemini.model': 'gemini-3.5-flash-lite',
    }));
    await expect(factory.getProvider().generateResponse({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] }))
      .resolves.toMatchObject({ text: 'answer' });
  });

  it("a BYO Gemini connection (buildFromCredentials) gets no fallback models -- stays single-model", async () => {
    mockSendMessage.mockRejectedValue(new Error('[503 Service Unavailable] high demand'));
    const factory = new ProviderFactory(makeConfig({}));
    const provider = factory.buildFromCredentials('gemini', 'gemini-3.5-flash-lite', 'user-key');

    await expect(provider.generateResponse({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('high demand');
    expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
  });
});
