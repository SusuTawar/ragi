import { loadConfig } from "../config.js";

function restoreEnvVar(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

test("loads default config when no files exist", async () => {
  const originalVectorStore = process.env.RAGI_VECTOR_STORE;
  const originalProvider = process.env.RAGI_EMBEDDING_PROVIDER;
  const originalModel = process.env.RAGI_EMBEDDING_MODEL;
  const originalBaseUrl = process.env.RAGI_EMBEDDING_BASE_URL;
  delete process.env.RAGI_VECTOR_STORE;
  delete process.env.RAGI_EMBEDDING_PROVIDER;
  delete process.env.RAGI_EMBEDDING_MODEL;
  delete process.env.RAGI_EMBEDDING_BASE_URL;
  
  try {
    const config = await loadConfig();
    
    expect(config.vectorStore).toBe('sqlite');
    expect(config.sqlite.path).toBe(':memory:');
    expect(config.embedding.provider).toBe('transformers_js');
    expect(config.embedding.model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(config.providers?.ollama?.baseUrl).toBe('http://localhost:11434');
    expect(config.providers?.llama_cpp?.baseUrl).toBe('http://localhost:8080');
    expect(config.chunking.maxSize).toBe(512);
    expect(config.chunking.overlap).toBe(50);
  } finally {
    restoreEnvVar('RAGI_VECTOR_STORE', originalVectorStore);
    restoreEnvVar('RAGI_EMBEDDING_PROVIDER', originalProvider);
    restoreEnvVar('RAGI_EMBEDDING_MODEL', originalModel);
    restoreEnvVar('RAGI_EMBEDDING_BASE_URL', originalBaseUrl);
  }
});

test("respects environment variable overrides", async () => {
  const originalVectorStore = process.env.RAGI_VECTOR_STORE;
  const originalProvider = process.env.RAGI_EMBEDDING_PROVIDER;
  const originalModel = process.env.RAGI_EMBEDDING_MODEL;
  const originalBaseUrl = process.env.RAGI_EMBEDDING_BASE_URL;
  process.env.RAGI_VECTOR_STORE = 'qdrant_local';
  process.env.RAGI_EMBEDDING_PROVIDER = 'ollama';
  process.env.RAGI_EMBEDDING_MODEL = 'nomic-embed-text';
  process.env.RAGI_EMBEDDING_BASE_URL = 'http://custom:8080';
  
  try {
    const config = await loadConfig();
    
    expect(config.vectorStore).toBe('qdrant_local');
    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.model).toBe('nomic-embed-text');
    expect(config.embedding.baseUrl).toBe('http://custom:8080');
  } finally {
    restoreEnvVar('RAGI_VECTOR_STORE', originalVectorStore);
    restoreEnvVar('RAGI_EMBEDDING_PROVIDER', originalProvider);
    restoreEnvVar('RAGI_EMBEDDING_MODEL', originalModel);
    restoreEnvVar('RAGI_EMBEDDING_BASE_URL', originalBaseUrl);
  }
});

test("fills embedding.baseUrl from provider defaults when provider-specific config exists", async () => {
  const originalProvider = process.env.RAGI_EMBEDDING_PROVIDER;
  const originalBaseUrl = process.env.RAGI_EMBEDDING_BASE_URL;
  process.env.RAGI_EMBEDDING_PROVIDER = 'ollama';
  delete process.env.RAGI_EMBEDDING_BASE_URL;

  try {
    const config = await loadConfig();

    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.baseUrl).toBe('http://localhost:11434');
  } finally {
    restoreEnvVar('RAGI_EMBEDDING_PROVIDER', originalProvider);
    restoreEnvVar('RAGI_EMBEDDING_BASE_URL', originalBaseUrl);
  }
});

console.log("✓ Config tests passed");
