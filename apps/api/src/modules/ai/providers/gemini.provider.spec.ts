const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerateContent }),
  })),
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
