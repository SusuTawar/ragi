// Local embedding service supporting Ollama API and Transformers.js
import { Config } from "./config";

/**
 * Embedding result
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: number[];
  /** Token count used */
  tokensUsed?: number;
}

/**
 * Local embedding service interface
 */
export class Embedder {
  private config: Config;
  private cache: Map<string, EmbeddingResult> = new Map();
  private transformersModel: any = null;
  private static readonly MAX_CACHE_SIZE = 1000; // LRU eviction limit

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Evict oldest entries when cache exceeds limit
   */
  private evictIfNeeded(): void {
    if (this.cache.size >= Embedder.MAX_CACHE_SIZE) {
      // Remove oldest 25% of entries (approximate LRU)
      const entries = Array.from(this.cache.entries());
      const toRemove = Math.floor(entries.length * 0.25);
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0]);
      }
    }
  }

  /**
   * Generate embeddings for text using the configured provider
   * Currently supports Ollama and Transformers.js
   */
  async embed(text: string): Promise<EmbeddingResult> {
    // Check cache first
    const cacheKey = `${this.config.embedding.model}:${text}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Route to appropriate provider
    let result: EmbeddingResult;
    switch (this.config.embedding.provider) {
      case 'ollama':
        result = await this.embedOllama(text);
        break;
      case 'transformers_js':
        result = await this.embedTransformersJs(text);
        break;
      case 'llama_cpp':
        result = await this.embedLlamaCpp(text);
        break;
      default:
        throw new Error(`Unknown embedding provider: ${this.config.embedding.provider}`);
    }

    // Cache result
    this.evictIfNeeded();
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Generate embeddings using Ollama API
   */
  private async embedOllama(text: string): Promise<EmbeddingResult> {
    const url = `${this.config.embedding.baseUrl || 'http://localhost:11434'}/api/embeddings`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.embedding.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embedding failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.embedding) {
      throw new Error('No embedding returned from Ollama');
    }

    return {
      embedding: data.embedding,
      tokensUsed: data.prompt_eval_count || undefined,
    };
  }

  /**
   * Generate embeddings using Transformers.js (runs natively in Bun)
   */
  private async embedTransformersJs(text: string): Promise<EmbeddingResult> {
    // Lazy load the model when first needed
    if (!this.transformersModel) {
      try {
        // Dynamically import transformers to avoid blocking if not used
        const { pipeline } = await import('@xenova/transformers');
        
        // Use the configured model or default to a lightweight model
        const modelName = this.config.embedding.model || 'XENOVA/all-MiniLM-L6-v2';
        this.transformersModel = await pipeline(
          'feature-extraction',
          modelName
        );
      } catch (err) {
        throw new Error(`Failed to load Transformers.js model: ${err}. Make sure @xenova/transformers is installed.`);
      }
    }

    try {
      // Generate embeddings
      const output = await this.transformersModel(text, {
        pooling: 'mean', // Mean pooling for sentence embedding
        normalize: true  // Normalize to unit vector
      });

      // Extract the embedding data
      const embeddingData = Array.from(output.data);
      
      return {
        embedding: embeddingData,
        tokensUsed: undefined // Transformers.js doesn't easily provide token count
      };
    } catch (err) {
      throw new Error(`Transformers.js embedding failed: ${err}`);
    }
  }

  /**
   * Generate embeddings using Llama.cpp server
   */
  private async embedLlamaCpp(text: string): Promise<EmbeddingResult> {
    const url = `${this.config.embedding.baseUrl || 'http://localhost:8080'}/embedding`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Llama.cpp embedding failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    // llama.cpp /embedding returns { embedding: [...] }
    if (!data.embedding) {
      throw new Error('No embedding returned from Llama.cpp server');
    }

    return {
      embedding: data.embedding,
      tokensUsed: undefined,
    };
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
    // Note: We don't reset the transformers model as it's expensive to reload
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

/**
 * Helper function to create an embedder from config
 */
export function createEmbedder(config: Config): Embedder {
  return new Embedder(config);
}