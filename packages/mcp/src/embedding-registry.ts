import { Embedding } from "@zilliz/claude-context-core";
import { ContextMcpConfig } from "./config.js";
import { createEmbeddingInstance } from "./embedding.js";

/**
 * Caches embedding instances by provider:model key.
 * When a codebase was indexed with a specific model, the registry
 * provides the matching embedding instance for search queries.
 */
export class EmbeddingRegistry {
    private cache: Map<string, Embedding> = new Map();
    private defaultConfig: ContextMcpConfig;

    constructor(defaultConfig: ContextMcpConfig) {
        this.defaultConfig = defaultConfig;
    }

    private getCacheKey(provider: string, model: string): string {
        return `${provider}:${model}`;
    }

    /**
     * Get or create an embedding instance for a specific provider:model.
     * Instances are cached so the same model is only instantiated once.
     */
    getOrCreate(provider: string, model: string): Embedding {
        const key = this.getCacheKey(provider, model);
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        console.log(`[EMBEDDING-REGISTRY] Creating new embedding instance for ${key}`);

        // Build a config override with the requested provider/model
        const overrideConfig: ContextMcpConfig = {
            ...this.defaultConfig,
            embeddingProvider: provider as ContextMcpConfig['embeddingProvider'],
            embeddingModel: model,
        };

        const embedding = createEmbeddingInstance(overrideConfig);
        this.cache.set(key, embedding);

        console.log(`[EMBEDDING-REGISTRY] Cached ${key} (total cached: ${this.cache.size})`);
        return embedding;
    }

    /**
     * Get the default embedding instance (from current env config).
     */
    getDefault(): Embedding {
        return this.getOrCreate(
            this.defaultConfig.embeddingProvider,
            this.defaultConfig.embeddingModel
        );
    }
}
