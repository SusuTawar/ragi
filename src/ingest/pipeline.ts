// Ingestion pipeline for processing documents into the RAG system
import { Embedder } from "../core/embedder";
import { SqliteAdapter } from "../adapters/sqlite";
import { ProjectContext } from "../core/project";
import { LoaderOptions, loadFiles } from "./loader";
import { SplitterOptions, splitText } from "./splitter";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";

/**
 * Pipeline options
 */
export interface PipelineOptions {
  /** Loader options */
  loader?: LoaderOptions;
  /** Splitter options */
  splitter?: SplitterOptions;
  /** Whether to skip already processed files (based on content hash) */
  skipExisting?: boolean;
  /** Batch size for embedding generation */
  batchSize?: number;
}

/**
 * Ingestion pipeline class
 */
export class IngestionPipeline {
  private embedder: Embedder;
  private vectorStore: SqliteAdapter;
  private projectContext: ProjectContext;
  private options: PipelineOptions;

  constructor(
    projectContext: ProjectContext,
    embedder: Embedder,
    vectorStore: SqliteAdapter,
    options: PipelineOptions = {}
  ) {
    this.projectContext = projectContext;
    this.embedder = embedder;
    this.vectorStore = vectorStore;
    this.options = {
      loader: {},
      splitter: { maxSize: 512, overlap: 50 },
      skipExisting: true,
      batchSize: 100,
      ...options
    };
  }

  /**
   * Process a file or directory and add its contents to the vector store
   * @param inputPath Path to file or directory to process
   */
  async process(inputPath: string): Promise<void> {
    // Initialize vector store if not already done
    await this.vectorStore.init();

    // Get absolute path - resolve properly regardless of input format
    const absolutePath = resolve(this.projectContext.path, inputPath);
    
    // Check if it's a file or directory
    const stats = await stat(absolutePath).catch(() => null);
    
    if (!stats) {
      throw new Error(`Path does not exist: ${absolutePath}`);
    }

    if (stats.isDirectory()) {
      await this.processDirectory(absolutePath);
    } else if (stats.isFile()) {
      await this.processFile(absolutePath);
    } else {
      throw new Error(`Unsupported path type: ${absolutePath}`);
    }
  }

  /**
   * Process all files in a directory recursively
   */
  private async processDirectory(dirPath: string): Promise<void> {
    console.log(`Processing directory: ${dirPath}`);
    
    // Load all files from directory
    const files = await loadFiles(
      dirPath,
      this.projectContext.path,
      this.options.loader
    );

    console.log(`Found ${files.length} files to process`);

    // Process each file
    for (const file of files) {
      try {
        await this.processFile(file.path);
      } catch (err) {
        console.error(`Failed to process file ${file.path}:`, err);
      }
    }
  }

  /**
   * Process a single file
   */
  private async processFile(filePath: string): Promise<void> {
    // Read file content once
    const content = await readFile(filePath, 'utf-8');
    
    if (!content.trim()) {
      console.log(`Skipping empty file: ${relative(this.projectContext.path, filePath)}`);
      return;
    }
    
    // Check if we should skip this file based on hash
    if (this.options.skipExisting) {
      const shouldSkip = await this.shouldSkipFile(filePath, content);
      if (shouldSkip) {
        console.log(`Skipping unchanged file: ${relative(this.projectContext.path, filePath)}`);
        return;
      }
    }

    console.log(`Processing file: ${relative(this.projectContext.path, filePath)}`);

    // Split text into chunks
    const chunks = splitText(content, this.options.splitter);
    
    console.log(`Split into ${chunks.length} chunks`);
    
    // Generate embeddings for chunks in batches
    const batchSize = this.options.batchSize ?? 100;
    const texts = chunks.map(chunk => chunk.text);
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchChunks = chunks.slice(i, i + batchSize);
      
      try {
        const embeddings = await this.generateEmbeddings(batch);
        
        // Prepare data for vector store
        const ids = batchChunks.map((chunk, index) => 
          `${this.hashFilePath(filePath)}_chunk_${i + index}`
        );
        const documents = batchChunks.map(chunk => chunk.text);
        const metadata = batchChunks.map((chunk, index) => ({
          filePath: relative(this.projectContext.path, filePath),
          chunkIndex: i + index,
          startIndex: chunk.startIndex,
          endIndex: chunk.endIndex,
          filePathAbsolute: filePath
        }));
        
        // Add to vector store
        await this.vectorStore.add(ids, embeddings, documents, metadata);
        
        console.log(`Processed batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(texts.length/batchSize)}`);
      } catch (err) {
        console.error(`Failed to process batch starting at index ${i}:`, err);
      }
    }
    
    // Update file hash record
    await this.updateFileHash(filePath, content);
  }

  /**
   * Generate embeddings for an array of texts
   */
  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    
    for (const text of texts) {
      const result = await this.embedder.embed(text);
      embeddings.push(result.embedding);
    }
    
    return embeddings;
  }

  /**
   * Calculate if a file should be skipped based on its hash
   */
  private async shouldSkipFile(filePath: string, content: string): Promise<boolean> {
    const contentHash = this.hashContent(content);
    
    // Check if document already exists by querying the vector store
    // We'll use the file path hash as the document ID prefix
    const docIdPrefix = this.hashFilePath(filePath);
    
    // If vector store has documents for this file, we'll skip
    // For now, return false to always process (proper hash tracking requires schema change)
    return false;
  }

  /**
   * Update the stored hash for a file
   * This stores hash in file metadata - actual implementation would update DB
   */
  private async updateFileHash(filePath: string, content: string): Promise<void> {
    // In production, update the document metadata with the hash
    // For now, this is a no-op as hash is stored inline
  }

  /**
   * Get stored hash for a file
   */
  private async getStoredFileHash(filePath: string): Promise<string | null> {
    // Would query DB for file hash - returning null for now
    return null;
  }

  /**
   * Hash file content
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Hash file path for generating unique IDs
   */
  private hashFilePath(filePath: string): string {
    return createHash('sha256').update(filePath, 'utf8').digest('hex').substring(0, 8);
  }
}

/**
 * Create an ingestion pipeline from project context and config
 */
export async function createIngestionPipeline(
  projectPath: string,
  config: any // Importing the Config type directly causes circular issues, so we use any
): Promise<IngestionPipeline> {
  // Import dependencies dynamically to avoid circular issues
  const { createProjectContext } = await import("../core/project");
  const { createEmbedder } = await import("../core/embedder");
  const { SqliteAdapter } = await import("../adapters/sqlite");
  
  // Create project context
  const projectContext = await createProjectContext(projectPath);
  
  // Create embedder
  const embedder = createEmbedder(config);
  
  // Get dimension from config model or default to 384 (all-MiniLM-L6-v2)
  const modelName = config.embedding?.model || 'Xenova/all-MiniLM-L6-v2';
  const dimension = modelName.includes('all-MiniLM') ? 384 : 768;
  
  // Create vector store
  const vectorStore = new SqliteAdapter(
    projectContext.id,
    projectContext.dbPath,
    dimension
  );
  
  // Get chunking config or use defaults
  const chunking = config.chunking || { maxSize: 512, overlap: 50 };
  
  // Create and return pipeline with config-based options
  return new IngestionPipeline(projectContext, embedder, vectorStore, {
    splitter: chunking
  });
}