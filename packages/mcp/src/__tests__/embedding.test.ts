import { jest } from '@jest/globals';

// Mock embedding classes from core
const MockOpenAIEmbedding = jest.fn();
const MockVoyageAIEmbedding = jest.fn();
const MockGeminiEmbedding = jest.fn();
const MockOllamaEmbedding = jest.fn();

jest.unstable_mockModule('@zilliz/claude-context-core', () => ({
    OpenAIEmbedding: MockOpenAIEmbedding,
    VoyageAIEmbedding: MockVoyageAIEmbedding,
    GeminiEmbedding: MockGeminiEmbedding,
    OllamaEmbedding: MockOllamaEmbedding,
}));

const { createEmbeddingInstance } = await import('../embedding.js');

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// Helper to build partial config
function makeConfig(overrides: Record<string, any> = {}) {
    return {
        embeddingProvider: 'OpenAI',
        embeddingModel: 'text-embedding-3-small',
        ...overrides,
    } as any;
}

describe('createEmbeddingInstance', () => {
    describe('OpenAI provider', () => {
        it('should create OpenAIEmbedding with correct config', () => {
            const config = makeConfig({
                embeddingProvider: 'OpenAI',
                embeddingModel: 'text-embedding-3-small',
                openaiApiKey: 'sk-test',
            });
            createEmbeddingInstance(config);
            expect(MockOpenAIEmbedding).toHaveBeenCalledWith({
                apiKey: 'sk-test',
                model: 'text-embedding-3-small',
            });
        });

        it('should throw when OPENAI_API_KEY is missing', () => {
            const config = makeConfig({
                embeddingProvider: 'OpenAI',
                openaiApiKey: undefined,
            });
            expect(() => createEmbeddingInstance(config)).toThrow('OPENAI_API_KEY');
        });

        it('should pass baseUrl when openaiBaseUrl is set', () => {
            const config = makeConfig({
                embeddingProvider: 'OpenAI',
                openaiApiKey: 'sk-test',
                openaiBaseUrl: 'https://custom.api.com',
            });
            createEmbeddingInstance(config);
            expect(MockOpenAIEmbedding).toHaveBeenCalledWith({
                apiKey: 'sk-test',
                model: 'text-embedding-3-small',
                baseURL: 'https://custom.api.com',
            });
        });
    });

    describe('VoyageAI provider', () => {
        it('should create VoyageAIEmbedding with correct config', () => {
            const config = makeConfig({
                embeddingProvider: 'VoyageAI',
                embeddingModel: 'voyage-code-3',
                voyageaiApiKey: 'pa-test',
            });
            createEmbeddingInstance(config);
            expect(MockVoyageAIEmbedding).toHaveBeenCalledWith({
                apiKey: 'pa-test',
                model: 'voyage-code-3',
            });
        });

        it('should throw when VOYAGEAI_API_KEY is missing', () => {
            const config = makeConfig({
                embeddingProvider: 'VoyageAI',
                voyageaiApiKey: undefined,
            });
            expect(() => createEmbeddingInstance(config)).toThrow('VOYAGEAI_API_KEY');
        });
    });

    describe('Gemini provider', () => {
        it('should create GeminiEmbedding with correct config', () => {
            const config = makeConfig({
                embeddingProvider: 'Gemini',
                embeddingModel: 'gemini-embedding-001',
                geminiApiKey: 'gem-test',
            });
            createEmbeddingInstance(config);
            expect(MockGeminiEmbedding).toHaveBeenCalledWith({
                apiKey: 'gem-test',
                model: 'gemini-embedding-001',
            });
        });

        it('should throw when GEMINI_API_KEY is missing', () => {
            const config = makeConfig({
                embeddingProvider: 'Gemini',
                geminiApiKey: undefined,
            });
            expect(() => createEmbeddingInstance(config)).toThrow('GEMINI_API_KEY');
        });
    });

    describe('Ollama provider', () => {
        it('should create OllamaEmbedding with correct config', () => {
            const config = makeConfig({
                embeddingProvider: 'Ollama',
                embeddingModel: 'nomic-embed-text',
                ollamaHost: 'http://localhost:11434',
            });
            createEmbeddingInstance(config);
            expect(MockOllamaEmbedding).toHaveBeenCalledWith({
                model: 'nomic-embed-text',
                host: 'http://localhost:11434',
            });
        });
    });

    describe('unsupported provider', () => {
        it('should throw for unsupported provider', () => {
            const config = makeConfig({ embeddingProvider: 'UnknownProvider' });
            expect(() => createEmbeddingInstance(config)).toThrow('Unsupported embedding provider');
        });
    });
});
