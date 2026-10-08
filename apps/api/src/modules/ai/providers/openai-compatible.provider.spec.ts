const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

import { OpenAICompatibleProvider } from './openai-compatible.provider';

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('serves the "openai" provider identity with its own label', () => {
    const provider = new OpenAICompatibleProvider('sk-key', 'gpt-4o', 'openai');
    expect(provider.getModelInfo()).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('serves "custom_openai_compatible" and "ollama" from the same class, just a different label/baseURL', () => {
    const custom = new OpenAICompatibleProvider('key', 'llama3', 'custom_openai_compatible', 'https://example.com/v1');
    const ollama = new OpenAICompatibleProvider(undefined, 'llama3', 'ollama', 'http://localhost:11434/v1');
    expect(custom.getModelInfo()).toEqual({ provider: 'custom_openai_compatible', model: 'llama3' });
    expect(ollama.getModelInfo()).toEqual({ provider: 'ollama', model: 'llama3' });
  });

  it('generateResponse extracts text and token usage from the chat completion', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'the answer' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    });
    const provider = new OpenAICompatibleProvider('sk-key', 'gpt-4o', 'openai');
    const result = await provider.generateResponse({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toEqual({ text: 'the answer', inputTokens: 12, outputTokens: 4 });
  });

  it('validateConnection succeeds when the provider responds normally', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'pong' } }] });
    const provider = new OpenAICompatibleProvider('sk-key', 'gpt-4o', 'openai');
    await expect(provider.validateConnection()).resolves.toEqual({ ok: true });
  });

  it('validateConnection fails with the provider\'s error when credentials are rejected -- never throws', async () => {
    mockCreate.mockRejectedValue(new Error('401 Unauthorized'));
    const provider = new OpenAICompatibleProvider('bad-key', 'gpt-4o', 'openai');
    await expect(provider.validateConnection()).resolves.toEqual({ ok: false, error: '401 Unauthorized' });
  });

  it('classifyRequest defaults to blocked (not ALLOW) when the provider call fails', async () => {
    mockCreate.mockRejectedValue(new Error('network unreachable'));
    const provider = new OpenAICompatibleProvider('sk-key', 'gpt-4o', 'openai');
    await expect(provider.classifyRequest('how tall is the Eiffel Tower?')).resolves.toEqual({ inDomain: false, reason: 'classification_unavailable' });
  });
});
