import { loadConfig, Config } from "../config";

test("loads default config when no files exist", async () => {
  const originalEnv = { ...process.env };
  delete process.env.BUN_RAG_VECTOR_STORE;
  delete process.env.BUN_RAG_EMBEDDING_PROVIDER;
  delete process.env.BUN_RAG_EMBEDDING_MODEL;
  delete process.env.BUN_RAG_EMBEDDING_BASE_URL;
  
  try {
    const config = await loadConfig();
    
    expect(config.vectorStore).toBe('sqlite');
    expect(config.sqlite.path).toBe(':memory:');
    expect(config.embedding.provider).toBe('transformers_js');
    expect(config.embedding.model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(config.chunking.maxSize).toBe(512);
    expect(config.chunking.overlap).toBe(50);
  } finally {
    process.env = originalEnv;
  }
});

test("respects environment variable overrides", async () => {
  const originalEnv = { ...process.env };
  process.env.BUN_RAG_VECTOR_STORE = 'qdrant_local';
  process.env.BUN_RAG_EMBEDDING_PROVIDER = 'ollama';
  process.env.BUN_RAG_EMBEDDING_MODEL = 'nomic-embed-text';
  process.env.BUN_RAG_EMBEDDING_BASE_URL = 'http://custom:8080';
  
  try {
    const config = await loadConfig();
    
    expect(config.vectorStore).toBe('qdrant_local');
    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.model).toBe('nomic-embed-text');
    expect(config.embedding.baseUrl).toBe('http://custom:8080');
  } finally {
    process.env = originalEnv;
  }
});

console.log("✓ Config tests passed");