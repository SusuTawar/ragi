// Test text splitter functionality
import { Embedder } from "../embedder";
import { Config } from "../config";

test("embedder initializes with config", () => {
  const config: Config = {
    vectorStore: 'sqlite',
    sqlite: { path: ':memory:' },
    embedding: {
      provider: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    },
    chunking: { maxSize: 512, overlap: 50 },
  };
  
  const embedder = new Embedder(config);
  expect(embedder).toBeInstanceOf(Embedder);
  expect(embedder.getCacheSize()).toBe(0);
});

test("embedder has cache methods", () => {
  const config: Config = {
    vectorStore: 'sqlite',
    sqlite: { path: ':memory:' },
    embedding: {
      provider: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    },
    chunking: { maxSize: 512, overlap: 50 },
  };
  
  const embedder = new Embedder(config);
  expect(typeof embedder.clearCache).toBe('function');
  expect(typeof embedder.getCacheSize).toBe('function');
  expect(embedder.getCacheSize()).toBe(0);
  
  // Add something to cache to test
  // @ts-ignore - accessing private property for test
  embedder.cache.set('test', { embedding: [0.1, 0.2], tokensUsed: 2 });
  expect(embedder.getCacheSize()).toBe(1);
  
  embedder.clearCache();
  expect(embedder.getCacheSize()).toBe(0);
});

test("embedder throws for unsupported providers", async () => {
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

console.log("✓ Embedder tests passed");