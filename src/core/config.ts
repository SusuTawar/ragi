// Configuration loader for ragi
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Global configuration interface
 */
export interface Config {
  vectorStore: 'sqlite' | 'qdrant_local';
  sqlite: { path: string };
  embedding: {
    provider: 'ollama' | 'transformers_js' | 'llama_cpp';
    /**
     * Recommended models by provider:
     * - ollama: `nomic-embed-text`
     * - transformers_js: `Xenova/all-MiniLM-L6-v2`
     * - llama_cpp: an embedding-capable GGUF model exposed by your llama.cpp server
     */
    model: string;
    baseUrl?: string;
  };
  providers?: {
    ollama?: {
      /** Usually paired with model `nomic-embed-text`. */
      baseUrl?: string;
    };
    llama_cpp?: {
      /** Pair with an embedding-capable model loaded by your llama.cpp server. */
      baseUrl?: string;
    };
  };
  chunking: { maxSize: number; overlap: number };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Config = {
  vectorStore: 'sqlite',
  sqlite: { path: ':memory:' },
  embedding: {
    provider: 'transformers_js',
    model: 'Xenova/all-MiniLM-L6-v2',
  },
  providers: {
    ollama: {
      baseUrl: 'http://localhost:11434',
    },
    llama_cpp: {
      baseUrl: 'http://localhost:8080',
    },
  },
  chunking: { maxSize: 512, overlap: 50 },
};

/**
 * Load configuration from file or environment
 * Priority: CLI args > local .ragrc > global config > defaults
 */
export async function loadConfig(): Promise<Config> {
  // Deep merge function
  const deepMerge = (target: any, source: any): any => {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  };
  
  // Start with defaults
  let config = { ...DEFAULT_CONFIG };

  // Try to load global config (~/.config/ragi/config.json)
  const globalConfigPath = join(homedir(), '.config', 'ragi', 'config.json');
  try {
    const globalConfigContent = await readFile(globalConfigPath, 'utf-8');
    config = deepMerge(config, JSON.parse(globalConfigContent));
  } catch (err) {
    // File doesn't exist or can't be read - use defaults
  }

  // Try to load local config (.ragrc in current directory or parent)
  const localConfigPath = await findLocalConfig();
  if (localConfigPath) {
    try {
      const localConfigContent = await readFile(localConfigPath, 'utf-8');
      config = deepMerge(config, JSON.parse(localConfigContent));
    } catch (err) {
      // File doesn't exist or can't be read - use what we have
    }
  }

  // Override with environment variables if present
  const vectorStore = process.env.RAGI_VECTOR_STORE;
  if (vectorStore) config.vectorStore = vectorStore as Config['vectorStore'];
  
  const provider = process.env.RAGI_EMBEDDING_PROVIDER;
  if (provider) config.embedding.provider = provider as Config['embedding']['provider'];
  
  const model = process.env.RAGI_EMBEDDING_MODEL;
  if (model) config.embedding.model = model;
  
  const baseUrl = process.env.RAGI_EMBEDDING_BASE_URL;
  if (baseUrl) config.embedding.baseUrl = baseUrl;
  
  if (!config.embedding.baseUrl) {
    if (config.embedding.provider === 'ollama') {
      config.embedding.baseUrl = config.providers?.ollama?.baseUrl;
    } else if (config.embedding.provider === 'llama_cpp') {
      config.embedding.baseUrl = config.providers?.llama_cpp?.baseUrl;
    }
  }

  return config;
}

/**
 * Find the nearest .ragrc file by walking up the directory tree
 */
async function findLocalConfig(): Promise<string | null> {
  let currentDir = process.cwd();
  const rootDir = '/';

  while (currentDir && currentDir !== rootDir) {
    const configPath = join(currentDir, '.ragrc');
    try {
      await readFile(configPath, 'utf-8');
      return configPath;
    } catch (err) {
      // File doesn't exist, continue up the tree
    }
    const parentDir = join(currentDir, '..');
    if (parentDir === currentDir) break; // Prevent infinite loop
    currentDir = parentDir;
  }

  return null;
}
