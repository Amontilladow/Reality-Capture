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

describe('AnthropicProvider.selectTools', () => {
  beforeEach(() => mockCreate.mockReset());

  it('returns the tool names the model chose to call', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'tool_use', id: 't1', name: 'getOpenRfis', input: {} },
        { type: 'tool_use', id: 't2', name: 'getOpenNcrs', input: {} },
      ],
    });
    const provider = new AnthropicProvider('key', 'claude-sonnet-4-6');
    await expect(provider.selectTools('Summarize open RFIs and NCRs.', [
      { name: 'getOpenRfis', description: 'List of open RFIs.' },
      { name: 'getOpenNcrs', description: 'List of open NCRs.' },
    ])).resolves.toEqual({ toolCalls: [{ name: 'getOpenRfis' }, { name: 'getOpenNcrs' }] });
  });

  it('returns an empty, non-failed result when the model decides no tool applies (text-only response)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: "RFI stands for Request for Information." }] });
    const provider = new AnthropicProvider('key', 'claude-sonnet-4-6');
    await expect(provider.selectTools('What does RFI stand for?', [{ name: 'getOpenRfis', description: 'd' }]))
      .resolves.toEqual({ toolCalls: [] });
  });

  it('reports failed: true (never throws) when the call itself errors', async () => {
    mockCreate.mockRejectedValue(new Error('overloaded_error'));
    const provider = new AnthropicProvider('key', 'claude-sonnet-4-6');
    await expect(provider.selectTools('Summarize open RFIs.', [{ name: 'getOpenRfis', description: 'd' }]))
      .resolves.toEqual({ toolCalls: [], failed: true });
  });
});
