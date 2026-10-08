const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

import { AnthropicProvider } from './anthropic.provider';

describe('AnthropicProvider.validateConnection', () => {
  beforeEach(() => mockCreate.mockReset());

  it('succeeds when the API responds normally', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'pong' }] });
    const provider = new AnthropicProvider('key', 'claude-sonnet-4-6');
    await expect(provider.validateConnection()).resolves.toEqual({ ok: true });
  });

  it('fails with the provider\'s error when the key is rejected -- never throws', async () => {
    mockCreate.mockRejectedValue(new Error('authentication_error'));
    const provider = new AnthropicProvider('bad-key', 'claude-sonnet-4-6');
    await expect(provider.validateConnection()).resolves.toEqual({ ok: false, error: 'authentication_error' });
  });
});
