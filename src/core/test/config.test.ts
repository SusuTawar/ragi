import { loadConfig } from "../config.js";

describe.sequential("config loading", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("loads default config when no files exist", async () => {
    vi.stubEnv("RAGI_VECTOR_STORE", "");
    vi.stubEnv("RAGI_EMBEDDING_PROVIDER", "");
    vi.stubEnv("RAGI_EMBEDDING_MODEL", "");
    vi.stubEnv("RAGI_EMBEDDING_BASE_URL", "");

    const config = await loadConfig();

    expect(config.vectorStore).toBe("sqlite");
    expect(config.sqlite.path).toBe(":memory:");
    expect(config.embedding.provider).toBe("transformers_js");
    expect(config.embedding.model).toBe("Xenova/all-MiniLM-L6-v2");
    expect(config.providers?.ollama?.baseUrl).toBe("http://localhost:11434");
    expect(config.providers?.llama_cpp?.baseUrl).toBe("http://localhost:8080");
    expect(config.chunking.maxSize).toBe(512);
    expect(config.chunking.overlap).toBe(50);
  });

  test("respects environment variable overrides", async () => {
    vi.stubEnv("RAGI_VECTOR_STORE", "");
    vi.stubEnv("RAGI_EMBEDDING_PROVIDER", "");
    vi.stubEnv("RAGI_EMBEDDING_MODEL", "");
    vi.stubEnv("RAGI_EMBEDDING_BASE_URL", "");

    vi.stubEnv("RAGI_VECTOR_STORE", "qdrant_local");
    vi.stubEnv("RAGI_EMBEDDING_PROVIDER", "ollama");
    vi.stubEnv("RAGI_EMBEDDING_MODEL", "nomic-embed-text");
    vi.stubEnv("RAGI_EMBEDDING_BASE_URL", "http://custom:8080");

    const config = await loadConfig();

    expect(config.vectorStore).toBe("qdrant_local");
    expect(config.embedding.provider).toBe("ollama");
    expect(config.embedding.model).toBe("nomic-embed-text");
    expect(config.embedding.baseUrl).toBe("http://custom:8080");
  });

  test("fills embedding.baseUrl from provider defaults when provider-specific config exists", async () => {
    vi.stubEnv("RAGI_VECTOR_STORE", "");
    vi.stubEnv("RAGI_EMBEDDING_PROVIDER", "");
    vi.stubEnv("RAGI_EMBEDDING_MODEL", "");
    vi.stubEnv("RAGI_EMBEDDING_BASE_URL", "");

    vi.stubEnv("RAGI_EMBEDDING_PROVIDER", "ollama");
    vi.stubEnv("RAGI_EMBEDDING_BASE_URL", "");

    const config = await loadConfig();

    expect(config.embedding.provider).toBe("ollama");
    expect(config.embedding.baseUrl).toBe("http://localhost:11434");
  });
});

console.log("Config tests passed");
