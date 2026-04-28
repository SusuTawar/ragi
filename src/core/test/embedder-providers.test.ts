// Test that all embedding providers are available in the interface
import { Embedder } from "../embedder";
import { Config } from "../config";

test("embedder accepts all three providers in config", () => {
  const ollamaConfig: Config = {
    vectorStore: 'sqlite',
    sqlite: { path: ':memory:' },
    embedding: {
      provider: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    },
    chunking: { maxSize: 512, overlap: 50 },
  };
  
  const transformersConfig: Config = {
    vectorStore: 'sqlite',
    sqlite: { path: ':memory:' },
    embedding: {
      provider: 'transformers_js',
      model: 'XENOVA/all-MiniLM-L6-v2',
    },
    chunking: { maxSize: 512, overlap: 50 },
  };
  
  const llamacppConfig: Config = {
    vectorStore: 'sqlite',
    sqlite: { path: ':memory:' },
    embedding: {
      provider: 'llama_cpp',
      model: 'all-MiniLM-L6-v2-gguf',
      baseUrl: 'http://localhost:8080',
    },
    chunking: { maxSize: 512, overlap: 50 },
  };
  
  // All should create embedders without throwing
  const ollamaEmbedder = new Embedder(ollamaConfig);
  const transformersEmbedder = new Embedder(transformersConfig);
  const llamacppEmbedder = new Embedder(llamacppConfig);
  
  expect(ollamaEmbedder).toBeInstanceOf(Embedder);
  expect(transformersEmbedder).toBeInstanceOf(Embedder);
  expect(llamacppEmbedder).toBeInstanceOf(Embedder);
});

test("embedder throws for truly unknown provider", async () => {
  const config: Config = {
    vectorStore: 'sqlite',
    sqlite: { path: ':memory:' },
    embedding: {
      provider: 'unknown_provider' as any,
      model: 'test',
    },
    chunking: { maxSize: 512, overlap: 50 },
  };
  
  const embedder = new Embedder(config);
  
  await expect(embedder.embed("test")).rejects.toThrow('Unknown embedding provider: unknown_provider');
});

console.log("✓ Embedder provider tests passed");