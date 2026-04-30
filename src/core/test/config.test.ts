import { loadConfig } from "../config.js";

function restoreEnvVar(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

const ORIGINAL_VECTOR_STORE = process.env.RAGI_VECTOR_STORE;
const ORIGINAL_PROVIDER = process.env.RAGI_EMBEDDING_PROVIDER;
const ORIGINAL_MODEL = process.env.RAGI_EMBEDDING_MODEL;
const ORIGINAL_BASE_URL = process.env.RAGI_EMBEDDING_BASE_URL;

afterEach(() => {
  restoreEnvVar('RAGI_VECTOR_STORE', ORIGINAL_VECTOR_STORE);
  restoreEnvVar('RAGI_EMBEDDING_PROVIDER', ORIGINAL_PROVIDER);
  restoreEnvVar('RAGI_EMBEDDING_MODEL', ORIGINAL_MODEL);
  restoreEnvVar('RAGI_EMBEDDING_BASE_URL', ORIGINAL_BASE_URL);
});

test.sequential("loads default config when no files exist", async () => {
  delete process.env.RAGI_VECTOR_STORE;
  delete process.env.RAGI_EMBEDDING_PROVIDER;
  delete process.env.RAGI_EMBEDDING_MODEL;
  delete process.env.RAGI_EMBEDDING_BASE_URL;

  const config = await loadConfig();

  expect(config.vectorStore).toBe('sqlite');
  expect(config.sqlite.path).toBe(':memory:');
  expect(config.embedding.provider).toBe('transformers_js');
  expect(config.embedding.model).toBe('Xenova/all-MiniLM-L6-v2');
  expect(config.providers?.ollama?.baseUrl).toBe('http://localhost:11434');
  expect(config.providers?.llama_cpp?.baseUrl).toBe('http://localhost:8080');
  expect(config.chunking.maxSize).toBe(512);
  expect(config.chunking.overlap).toBe(50);
});

test.sequential("respects environment variable overrides", async () => {
  process.env.RAGI_VECTOR_STORE = 'qdrant_local';
  process.env.RAGI_EMBEDDING_PROVIDER = 'ollama';
  process.env.RAGI_EMBEDDING_MODEL = 'nomic-embed-text';
  process.env.RAGI_EMBEDDING_BASE_URL = 'http://custom:8080';

  const config = await loadConfig();

  expect(config.vectorStore).toBe('qdrant_local');
  expect(config.embedding.provider).toBe('ollama');
  expect(config.embedding.model).toBe('nomic-embed-text');
  expect(config.embedding.baseUrl).toBe('http://custom:8080');
});

test.sequential("fills embedding.baseUrl from provider defaults when provider-specific config exists", async () => {
  process.env.RAGI_EMBEDDING_PROVIDER = 'ollama';
  delete process.env.RAGI_EMBEDDING_BASE_URL;

  const config = await loadConfig();

  expect(config.embedding.provider).toBe('ollama');
  expect(config.embedding.baseUrl).toBe('http://localhost:11434');
});

console.log("✓ Config tests passed");
