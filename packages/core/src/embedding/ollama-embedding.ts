import { Ollama } from 'ollama';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface OllamaEmbeddingConfig {
    model: string;
    host?: string;
    fetch?: any;
    keepAlive?: string | number;
    options?: Record<string, any>;
    dimension?: number; // Optional dimension parameter
    maxTokens?: number; // Optional max tokens parameter
}

export class OllamaEmbedding extends Embedding {
    private client: Ollama;
    private config: OllamaEmbeddingConfig;
    private dimension: number = 768; // Default dimension for many embedding models
    private dimensionDetected: boolean = false; // Track if dimension has been detected
    private contextLengthDetected: boolean = false; // Track if context length has been detected
    protected maxTokens: number = 512; // Conservative default until detected

    constructor(config: OllamaEmbeddingConfig) {
        super();
        this.config = config;
        this.client = new Ollama({
            host: config.host || 'http://127.0.0.1:11434',
            fetch: config.fetch,
        });

        // Set dimension based on config or will be detected on first use
        if (config.dimension) {
            this.dimension = config.dimension;
            this.dimensionDetected = true;
        }

        // Set max tokens based on config or will be detected on first use
        if (config.maxTokens) {
            this.maxTokens = config.maxTokens;
            this.contextLengthDetected = true;
        }

        // If no dimension/maxTokens provided, they will be detected in the first embed call
    }

    /**
     * Detect the model's actual context length by querying Ollama's /api/show endpoint.
     * Looks for any key matching *.context_length in model_info (e.g. bert.context_length,
     * nomic-bert.context_length).
     * Falls back to 512 if detection fails.
     */
    async detectContextLength(): Promise<number> {
        console.log(`[OllamaEmbedding] Detecting context length for model: ${this.config.model}...`);
        try {
            const response = await this.client.show({ model: this.config.model });
            const modelInfo = (response as any).model_info || {};

            for (const [key, value] of Object.entries(modelInfo)) {
                if (key.endsWith('.context_length') && typeof value === 'number') {
                    console.log(`[OllamaEmbedding] 📏 Detected context length: ${value} tokens (from ${key})`);
                    return value;
                }
            }

            console.warn(`[OllamaEmbedding] ⚠️ No context_length found in model_info, using default 512`);
            return 512;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[OllamaEmbedding] Failed to detect context length: ${errorMessage}, using default 512`);
            return 512;
        }
    }

    /**
     * Ensure dimension and context length are detected before first use.
     */
    private async ensureModelInfoDetected(): Promise<void> {
        if (!this.dimensionDetected && !this.config.dimension) {
            this.dimension = await this.detectDimension();
            this.dimensionDetected = true;
            console.log(`[OllamaEmbedding] 📏 Detected Ollama embedding dimension: ${this.dimension} for model: ${this.config.model}`);
        }
        if (!this.contextLengthDetected && !this.config.maxTokens) {
            this.maxTokens = await this.detectContextLength();
            this.contextLengthDetected = true;
        }
    }

    async embed(text: string): Promise<EmbeddingVector> {
        // Detect model info (dimension + context length) on first use
        await this.ensureModelInfoDetected();

        // Preprocess the text (truncation uses detected maxTokens)
        const processedText = this.preprocessText(text);

        const embedOptions: any = {
            model: this.config.model,
            input: processedText,
            options: this.config.options,
        };

        // Only include keep_alive if it has a valid value
        if (this.config.keepAlive && this.config.keepAlive !== '') {
            embedOptions.keep_alive = this.config.keepAlive;
        }

        const response = await this.client.embed(embedOptions);

        if (!response.embeddings || !response.embeddings[0]) {
            throw new Error('Ollama API returned invalid response');
        }

        return {
            vector: response.embeddings[0],
            dimension: this.dimension
        };
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        // Detect model info (dimension + context length) on first use
        await this.ensureModelInfoDetected();

        // Preprocess all texts (truncation uses detected maxTokens)
        const processedTexts = this.preprocessTexts(texts);

        // Use Ollama's native batch embedding API
        const embedOptions: any = {
            model: this.config.model,
            input: processedTexts, // Pass array directly to Ollama
            options: this.config.options,
        };

        // Only include keep_alive if it has a valid value
        if (this.config.keepAlive && this.config.keepAlive !== '') {
            embedOptions.keep_alive = this.config.keepAlive;
        }

        const response = await this.client.embed(embedOptions);

        if (!response.embeddings || !Array.isArray(response.embeddings)) {
            throw new Error('Ollama API returned invalid batch response');
        }

        // Convert to EmbeddingVector format
        return response.embeddings.map((embedding: number[]) => ({
            vector: embedding,
            dimension: this.dimension
        }));
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'Ollama';
    }

    getModel(): string {
        return this.config.model;
    }

    /**
     * Set model type and detect its dimension
     * @param model Model name
     */
    async setModel(model: string): Promise<void> {
        this.config.model = model;
        // Reset detection flags when model changes
        this.dimensionDetected = false;
        this.contextLengthDetected = false;
        // Re-detect on next use
        await this.ensureModelInfoDetected();
    }

    /**
     * Set host URL
     * @param host Ollama host URL
     */
    setHost(host: string): void {
        this.config.host = host;
        this.client = new Ollama({
            host: host,
            fetch: this.config.fetch,
        });
    }

    /**
     * Set keep alive duration
     * @param keepAlive Keep alive duration
     */
    setKeepAlive(keepAlive: string | number): void {
        this.config.keepAlive = keepAlive;
    }

    /**
     * Set additional options
     * @param options Additional options for the model
     */
    setOptions(options: Record<string, any>): void {
        this.config.options = options;
    }

    /**
     * Set max tokens manually
     * @param maxTokens Maximum number of tokens
     */
    setMaxTokens(maxTokens: number): void {
        this.config.maxTokens = maxTokens;
        this.maxTokens = maxTokens;
    }

    /**
     * Get client instance (for advanced usage)
     */
    getClient(): Ollama {
        return this.client;
    }

    async detectDimension(testText: string = "test"): Promise<number> {
        console.log(`[OllamaEmbedding] Detecting embedding dimension...`);

        try {
            const processedText = this.preprocessText(testText);
            const embedOptions: any = {
                model: this.config.model,
                input: processedText,
                options: this.config.options,
            };

            if (this.config.keepAlive && this.config.keepAlive !== '') {
                embedOptions.keep_alive = this.config.keepAlive;
            }

            const response = await this.client.embed(embedOptions);

            if (!response.embeddings || !response.embeddings[0]) {
                throw new Error('Ollama API returned invalid response');
            }

            const dimension = response.embeddings[0].length;
            console.log(`[OllamaEmbedding] Successfully detected embedding dimension: ${dimension}`);
            return dimension;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[OllamaEmbedding] Failed to detect dimension: ${errorMessage}`);
            throw new Error(`Failed to detect Ollama embedding dimension: ${errorMessage}`);
        }
    }
}