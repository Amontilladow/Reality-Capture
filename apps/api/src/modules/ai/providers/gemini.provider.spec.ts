const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn().mockReturnValue({ generateContent: mockGenerateContent });

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
  beforeEach(() => mockGenerateContent.mockReset());

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
});
