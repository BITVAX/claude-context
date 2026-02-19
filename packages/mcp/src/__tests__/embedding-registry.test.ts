import { jest } from '@jest/globals';

// --- Mock createEmbeddingInstance before importing EmbeddingRegistry ---

let callCount = 0;
const mockCreateEmbeddingInstance = jest.fn<(config: any) => any>().mockImplementation(() => ({
    id: ++callCount, // unique object per call
}));

jest.unstable_mockModule('../embedding.js', () => ({
    createEmbeddingInstance: mockCreateEmbeddingInstance,
}));

const { EmbeddingRegistry } = await import('../embedding-registry.js');

beforeEach(() => {
    callCount = 0;
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

function makeConfig(overrides: Record<string, any> = {}) {
    return {
        embeddingProvider: 'OpenAI',
        embeddingModel: 'text-embedding-3-small',
        openaiApiKey: 'sk-test',
        ...overrides,
    } as any;
}

describe('EmbeddingRegistry', () => {
    describe('getOrCreate', () => {
        it('should create a new embedding instance for a new provider:model', () => {
            const registry = new EmbeddingRegistry(makeConfig());

            const instance = registry.getOrCreate('OpenAI', 'text-embedding-3-small');

            expect(mockCreateEmbeddingInstance).toHaveBeenCalledTimes(1);
            expect(instance).toBeDefined();
        });

        it('should return cached instance for same provider:model', () => {
            const registry = new EmbeddingRegistry(makeConfig());

            const first = registry.getOrCreate('OpenAI', 'text-embedding-3-small');
            const second = registry.getOrCreate('OpenAI', 'text-embedding-3-small');

            expect(mockCreateEmbeddingInstance).toHaveBeenCalledTimes(1);
            expect(first).toBe(second); // same reference
        });

        it('should create different instances for different provider:model combos', () => {
            const registry = new EmbeddingRegistry(makeConfig());

            const openai = registry.getOrCreate('OpenAI', 'text-embedding-3-small');
            const ollama = registry.getOrCreate('Ollama', 'nomic-embed-text');

            expect(mockCreateEmbeddingInstance).toHaveBeenCalledTimes(2);
            expect(openai).not.toBe(ollama);
        });

        it('should create different instances for same provider but different models', () => {
            const registry = new EmbeddingRegistry(makeConfig());

            const small = registry.getOrCreate('OpenAI', 'text-embedding-3-small');
            const large = registry.getOrCreate('OpenAI', 'text-embedding-3-large');

            expect(mockCreateEmbeddingInstance).toHaveBeenCalledTimes(2);
            expect(small).not.toBe(large);
        });

        it('should pass overridden config with requested provider:model', () => {
            const baseConfig = makeConfig({
                embeddingProvider: 'OpenAI',
                embeddingModel: 'text-embedding-3-small',
            });
            const registry = new EmbeddingRegistry(baseConfig);

            registry.getOrCreate('Ollama', 'nomic-embed-text');

            const passedConfig = mockCreateEmbeddingInstance.mock.calls[0][0];
            expect(passedConfig.embeddingProvider).toBe('Ollama');
            expect(passedConfig.embeddingModel).toBe('nomic-embed-text');
            // Should preserve other config fields from base
            expect(passedConfig.openaiApiKey).toBe('sk-test');
        });
    });

    describe('getDefault', () => {
        it('should return embedding for the default config provider:model', () => {
            const config = makeConfig({
                embeddingProvider: 'VoyageAI',
                embeddingModel: 'voyage-code-3',
            });
            const registry = new EmbeddingRegistry(config);

            const instance = registry.getDefault();

            expect(mockCreateEmbeddingInstance).toHaveBeenCalledTimes(1);
            const passedConfig = mockCreateEmbeddingInstance.mock.calls[0][0];
            expect(passedConfig.embeddingProvider).toBe('VoyageAI');
            expect(passedConfig.embeddingModel).toBe('voyage-code-3');
            expect(instance).toBeDefined();
        });

        it('should reuse cached instance on subsequent calls', () => {
            const registry = new EmbeddingRegistry(makeConfig());

            const first = registry.getDefault();
            const second = registry.getDefault();

            expect(mockCreateEmbeddingInstance).toHaveBeenCalledTimes(1);
            expect(first).toBe(second);
        });

        it('should share cache with getOrCreate for matching key', () => {
            const config = makeConfig({
                embeddingProvider: 'OpenAI',
                embeddingModel: 'text-embedding-3-small',
            });
            const registry = new EmbeddingRegistry(config);

            const fromDefault = registry.getDefault();
            const fromGetOrCreate = registry.getOrCreate('OpenAI', 'text-embedding-3-small');

            expect(mockCreateEmbeddingInstance).toHaveBeenCalledTimes(1);
            expect(fromDefault).toBe(fromGetOrCreate);
        });
    });
});
