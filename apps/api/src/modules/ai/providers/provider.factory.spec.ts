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
