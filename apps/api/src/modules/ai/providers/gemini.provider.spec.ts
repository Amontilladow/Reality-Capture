const mockGenerateContent = jest.fn();
const mockSendMessage = jest.fn();
const mockStartChat = jest.fn().mockReturnValue({ sendMessage: mockSendMessage });
const mockGetGenerativeModel = jest.fn().mockReturnValue({ generateContent: mockGenerateContent, startChat: mockStartChat });

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  SchemaType: { OBJECT: 'OBJECT' },
}));

import { GeminiProvider } from './gemini.provider';

describe('GeminiProvider.validateConnection', () => {
  beforeEach(() => mockGenerateContent.mockReset());

  it('succeeds when the API responds normally', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'pong' } });
    const provider = new GeminiProvider('key', 'gemini-2.0-flash');
    await expect(provider.validateConnection()).resolves.toEqual({ ok: true });
  });

  it('fails with the provider\'s error when the key is rejected -- never throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API key not valid'));
    const provider = new GeminiProvider('bad-key', 'gemini-2.0-flash');
    await expect(provider.validateConnection()).resolves.toEqual({ ok: false, error: 'API key not valid' });
  });
});

describe('GeminiProvider.selectTools', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGetGenerativeModel.mockClear();
  });

  it('returns the tool names the model chose to call', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { functionCalls: () => [{ name: 'getOpenRfis', args: {} }, { name: 'getOpenNcrs', args: {} }] },
    });
    const provider = new GeminiProvider('key', 'gemini-2.0-flash');
    await expect(provider.selectTools('Summarize open RFIs and NCRs.', [
      { name: 'getOpenRfis', description: 'List of open RFIs.' },
      { name: 'getOpenNcrs', description: 'List of open NCRs.' },
    ])).resolves.toEqual({ toolCalls: [{ name: 'getOpenRfis' }, { name: 'getOpenNcrs' }] });
  });

  it('returns an empty, non-failed result when the model decides no tool applies', async () => {
    mockGenerateContent.mockResolvedValue({ response: { functionCalls: () => undefined } });
    const provider = new GeminiProvider('key', 'gemini-2.0-flash');
    await expect(provider.selectTools('What does RFI stand for?', [{ name: 'getOpenRfis', description: 'd' }]))
      .resolves.toEqual({ toolCalls: [] });
  });

  it('reports failed: true (never throws) when the call itself errors', async () => {
    mockGenerateContent.mockRejectedValue(new Error('model does not support tool calling'));
    const provider = new GeminiProvider('key', 'gemini-2.0-flash');
    await expect(provider.selectTools('Summarize open RFIs.', [{ name: 'getOpenRfis', description: 'd' }]))
      .resolves.toEqual({ toolCalls: [], failed: true });
  });

  it('falls back to the next model in the chain on a retriable error and still returns real tool calls', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error('[503 Service Unavailable] This model is currently experiencing high demand.'))
      .mockResolvedValueOnce({ response: { functionCalls: () => [{ name: 'getOpenRfis', args: {} }] } });
    const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite', ['gemini-3.1-flash-lite']);

    await expect(provider.selectTools('Summarize open RFIs.', [{ name: 'getOpenRfis', description: 'd' }]))
      .resolves.toEqual({ toolCalls: [{ name: 'getOpenRfis' }] });
    expect(mockGetGenerativeModel.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  });
});

// Owner-reported outage: gemini-3.5-flash-lite (the model this project
// locked in as "confirmed working" after two earlier Gemini capacity
// incidents the same day) itself returned a 503 "experiencing high demand"
// in production -- the third model tier to do so. These tests lock in the
// fix: a failed request retries against each configured fallback model
// before the assistant is reported unavailable.
describe('GeminiProvider.generateResponse -- model fallback', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockStartChat.mockClear();
    mockGetGenerativeModel.mockClear();
  });

  const input = { systemPrompt: 'sys', messages: [{ role: 'user' as const, content: 'Summarize open RFIs.' }] };

  it('uses only the primary model when it succeeds -- no fallback touched', async () => {
    mockSendMessage.mockResolvedValue({ response: { text: () => 'the answer', usageMetadata: {} } });
    const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite', ['gemini-3.1-flash-lite', 'gemini-3.8-flash']);

    const result = await provider.generateResponse(input);

    expect(result.text).toBe('the answer');
    expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
    expect(mockGetGenerativeModel.mock.calls[0][0].model).toBe('gemini-3.5-flash-lite');
  });

  it('retries the next model on a 503 "high demand" error and returns its answer', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new Error('[503 Service Unavailable] This model is currently experiencing high demand. Spikes in demand are usually temporary.'))
      .mockResolvedValueOnce({ response: { text: () => 'answer from fallback model', usageMetadata: {} } });
    const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite', ['gemini-3.1-flash-lite', 'gemini-3.8-flash']);

    const result = await provider.generateResponse(input);

    expect(result.text).toBe('answer from fallback model');
    expect(mockGetGenerativeModel.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  });

  it('works through the whole chain and rethrows the last error if every model fails', async () => {
    mockSendMessage.mockRejectedValue(new Error('[503 Service Unavailable] This model is currently experiencing high demand.'));
    const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite', ['gemini-3.1-flash-lite']);

    await expect(provider.generateResponse(input)).rejects.toThrow('high demand');
    expect(mockGetGenerativeModel.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  });

  it('does not try a fallback model for a non-retriable error (e.g. a bad API key) -- fails immediately', async () => {
    mockSendMessage.mockRejectedValue(new Error('[400 Bad Request] API key not valid.'));
    const provider = new GeminiProvider('bad-key', 'gemini-3.5-flash-lite', ['gemini-3.1-flash-lite']);

    await expect(provider.generateResponse(input)).rejects.toThrow('API key not valid');
    expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
  });

  it('deduplicates a fallback model that is the same as the primary', async () => {
    mockSendMessage.mockResolvedValue({ response: { text: () => 'ok', usageMetadata: {} } });
    const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite', ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);

    await provider.generateResponse(input);

    // Only one entry for the primary model despite it also being listed as
    // its own fallback -- confirms modelChain is deduped via Set.
    expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
  });

  it('with no fallback models configured, behaves exactly like a single-model call', async () => {
    mockSendMessage.mockRejectedValue(new Error('[503 Service Unavailable] high demand'));
    const provider = new GeminiProvider('key', 'gemini-3.5-flash-lite');

    await expect(provider.generateResponse(input)).rejects.toThrow('high demand');
    expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
  });
});
