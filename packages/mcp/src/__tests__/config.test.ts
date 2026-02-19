import { jest } from '@jest/globals';

// Mock envManager before importing config module
const mockEnvGet = jest.fn<(name: string) => string | undefined>();

jest.unstable_mockModule('@zilliz/claude-context-core', () => ({
    envManager: { get: mockEnvGet },
}));

// Dynamic import AFTER mock setup (required for ESM)
const {
    getDefaultModelForProvider,
    getEmbeddingModelForProvider,
    createMcpConfig,
} = await import('../config.js');

// Suppress console output during tests
beforeEach(() => {
    mockEnvGet.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('getDefaultModelForProvider', () => {
    it('should return "text-embedding-3-small" for OpenAI', () => {
        expect(getDefaultModelForProvider('OpenAI')).toBe('text-embedding-3-small');
    });

    it('should return "voyage-code-3" for VoyageAI', () => {
        expect(getDefaultModelForProvider('VoyageAI')).toBe('voyage-code-3');
    });

    it('should return "gemini-embedding-001" for Gemini', () => {
        expect(getDefaultModelForProvider('Gemini')).toBe('gemini-embedding-001');
    });

    it('should return "nomic-embed-text" for Ollama', () => {
        expect(getDefaultModelForProvider('Ollama')).toBe('nomic-embed-text');
    });

    it('should return "text-embedding-3-small" for unknown provider', () => {
        expect(getDefaultModelForProvider('UnknownProvider')).toBe('text-embedding-3-small');
    });
});

describe('getEmbeddingModelForProvider', () => {
    it('should prioritize OLLAMA_MODEL over EMBEDDING_MODEL for Ollama', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'OLLAMA_MODEL') return 'custom-ollama-model';
            if (name === 'EMBEDDING_MODEL') return 'generic-model';
            return undefined;
        });
        expect(getEmbeddingModelForProvider('Ollama')).toBe('custom-ollama-model');
    });

    it('should fall back to EMBEDDING_MODEL when OLLAMA_MODEL not set for Ollama', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'OLLAMA_MODEL') return undefined;
            if (name === 'EMBEDDING_MODEL') return 'generic-model';
            return undefined;
        });
        expect(getEmbeddingModelForProvider('Ollama')).toBe('generic-model');
    });

    it('should fall back to default when neither env var set for Ollama', () => {
        mockEnvGet.mockReturnValue(undefined);
        expect(getEmbeddingModelForProvider('Ollama')).toBe('nomic-embed-text');
    });

    it('should use EMBEDDING_MODEL for OpenAI when set', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'EMBEDDING_MODEL') return 'text-embedding-3-large';
            return undefined;
        });
        expect(getEmbeddingModelForProvider('OpenAI')).toBe('text-embedding-3-large');
    });

    it('should use default model for OpenAI when EMBEDDING_MODEL not set', () => {
        mockEnvGet.mockReturnValue(undefined);
        expect(getEmbeddingModelForProvider('OpenAI')).toBe('text-embedding-3-small');
    });

    it('should use EMBEDDING_MODEL for VoyageAI when set', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'EMBEDDING_MODEL') return 'voyage-3-large';
            return undefined;
        });
        expect(getEmbeddingModelForProvider('VoyageAI')).toBe('voyage-3-large');
    });

    it('should use EMBEDDING_MODEL for Gemini when set', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'EMBEDDING_MODEL') return 'gemini-embedding-custom';
            return undefined;
        });
        expect(getEmbeddingModelForProvider('Gemini')).toBe('gemini-embedding-custom');
    });
});

describe('createMcpConfig', () => {
    it('should return config with all defaults when no env vars set', () => {
        mockEnvGet.mockReturnValue(undefined);
        const config = createMcpConfig();
        expect(config.name).toBe('Context MCP Server');
        expect(config.version).toBe('1.0.0');
        expect(config.embeddingProvider).toBe('OpenAI');
        expect(config.embeddingModel).toBe('text-embedding-3-small');
    });

    it('should read EMBEDDING_PROVIDER from env', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'EMBEDDING_PROVIDER') return 'Ollama';
            return undefined;
        });
        const config = createMcpConfig();
        expect(config.embeddingProvider).toBe('Ollama');
        // Ollama default model
        expect(config.embeddingModel).toBe('nomic-embed-text');
    });

    it('should read API keys from env', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'OPENAI_API_KEY') return 'sk-test-key';
            if (name === 'VOYAGEAI_API_KEY') return 'pa-test-key';
            if (name === 'GEMINI_API_KEY') return 'gemini-test-key';
            return undefined;
        });
        const config = createMcpConfig();
        expect(config.openaiApiKey).toBe('sk-test-key');
        expect(config.voyageaiApiKey).toBe('pa-test-key');
        expect(config.geminiApiKey).toBe('gemini-test-key');
    });

    it('should read Milvus config from env', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'MILVUS_ADDRESS') return 'localhost:19530';
            if (name === 'MILVUS_TOKEN') return 'test-token';
            return undefined;
        });
        const config = createMcpConfig();
        expect(config.milvusAddress).toBe('localhost:19530');
        expect(config.milvusToken).toBe('test-token');
    });

    it('should read server name and version from env', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'MCP_SERVER_NAME') return 'My Custom Server';
            if (name === 'MCP_SERVER_VERSION') return '2.5.0';
            return undefined;
        });
        const config = createMcpConfig();
        expect(config.name).toBe('My Custom Server');
        expect(config.version).toBe('2.5.0');
    });

    it('should read Ollama-specific config from env', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'EMBEDDING_PROVIDER') return 'Ollama';
            if (name === 'OLLAMA_MODEL') return 'mxbai-embed-large';
            if (name === 'OLLAMA_HOST') return 'http://remote:11434';
            return undefined;
        });
        const config = createMcpConfig();
        expect(config.ollamaModel).toBe('mxbai-embed-large');
        expect(config.ollamaHost).toBe('http://remote:11434');
    });

    it('should read OpenAI and Gemini base URLs from env', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'OPENAI_BASE_URL') return 'https://custom-openai.example.com';
            if (name === 'GEMINI_BASE_URL') return 'https://custom-gemini.example.com';
            return undefined;
        });
        const config = createMcpConfig();
        expect(config.openaiBaseUrl).toBe('https://custom-openai.example.com');
        expect(config.geminiBaseUrl).toBe('https://custom-gemini.example.com');
    });

    it('should leave optional fields undefined when not set', () => {
        mockEnvGet.mockReturnValue(undefined);
        const config = createMcpConfig();
        expect(config.openaiApiKey).toBeUndefined();
        expect(config.voyageaiApiKey).toBeUndefined();
        expect(config.geminiApiKey).toBeUndefined();
        expect(config.milvusAddress).toBeUndefined();
        expect(config.milvusToken).toBeUndefined();
        expect(config.ollamaModel).toBeUndefined();
        expect(config.ollamaHost).toBeUndefined();
        expect(config.openaiBaseUrl).toBeUndefined();
        expect(config.geminiBaseUrl).toBeUndefined();
    });
});
