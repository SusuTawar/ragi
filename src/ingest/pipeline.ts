// Ingestion pipeline for processing documents into the RAG system
import { Embedder } from "../core/embedder";
import { SqliteAdapter } from "../adapters/sqlite";
import type { ProjectContext } from "../core/project";
import { classifyFile, loadFiles } from "./loader";
import type { LoadedFile, LoaderOptions } from "./loader";
import { splitDocument } from "./splitter";
import type { SplitterOptions } from "./splitter";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, relative, resolve } from "node:path";

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
    await this.vectorStore.init();

    const absolutePath = resolve(this.projectContext.path, inputPath);
    const stats = await stat(absolutePath).catch(() => null);

    if (!stats) {
      throw new Error(`Path does not exist: ${absolutePath}`);
    }

    if (stats.isDirectory()) {
      await this.processDirectory(absolutePath);
      return;
    }

    if (stats.isFile()) {
      const file = await this.loadSingleFile(absolutePath);
      if (!file) {
        throw new Error(`Unsupported or unreadable file: ${absolutePath}`);
      }
      await this.processLoadedFile(file);
      return;
    }

    throw new Error(`Unsupported path type: ${absolutePath}`);
  }

  /**
   * Process all files in a directory recursively
   */
  private async processDirectory(dirPath: string): Promise<void> {
    process.stderr.write(`Processing directory: ${dirPath}\n`);

    const files = await loadFiles(
      dirPath,
      this.projectContext.path,
      {
        ...this.options.loader,
        rootPath: dirPath,
      }
    );

    process.stderr.write(`Found ${files.length} files to process\n`);

    await this.pruneStaleFiles(dirPath, files);

    for (const file of files) {
      try {
        await this.processLoadedFile(file);
      } catch (err) {
        process.stderr.write(`Failed to process file ${file.path}: ${String(err)}\n`);
      }
    }
  }

  private async loadSingleFile(filePath: string): Promise<LoadedFile | null> {
    try {
      const fileStat = await stat(filePath);
      const content = await readFile(filePath, "utf-8");
      const extension = extname(filePath).toLowerCase();
      const relativePath = this.normalizeRelativePath(relative(this.projectContext.path, filePath));
      const fileType = classifyFile(relativePath, extension);

      return {
        path: filePath,
        relativePath,
        content,
        size: fileStat.size,
        extension,
        modifiedTime: fileStat.mtimeMs,
        fileType,
        fileName: basename(filePath),
      };
    } catch {
      return null;
    }
  }

  private async processLoadedFile(file: LoadedFile): Promise<void> {
    if (!file.content.trim()) {
      process.stderr.write(`Skipping empty file: ${file.relativePath}\n`);
      return;
    }

    const contentHash = this.hashContent(file.content);
    if (this.options.skipExisting) {
      const shouldSkip = await this.shouldSkipFile(file.relativePath, contentHash);
      if (shouldSkip) {
        process.stderr.write(`Skipping unchanged file: ${file.relativePath}\n`);
        return;
      }
    }

    process.stderr.write(`Processing file: ${file.relativePath}\n`);

    await this.vectorStore.deleteByFilePaths([file.relativePath]);

    const chunks = splitDocument(file.content, this.options.splitter ?? { maxSize: 512, overlap: 50 }, {
      extension: file.extension,
    });
    process.stderr.write(`Split into ${chunks.length} chunks\n`);

    const batchSize = this.options.batchSize ?? 100;
    const texts = chunks.map((chunk) => chunk.text);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchChunks = chunks.slice(i, i + batchSize);
      const embeddings = await this.generateEmbeddings(batch);

      const ids = batchChunks.map((_, index) => `${this.hashFilePath(file.relativePath)}_chunk_${i + index}`);
      const documents = batchChunks.map((chunk) => chunk.text);
      const metadata = batchChunks.map((chunk, index) => ({
        filePath: file.relativePath,
        filePathAbsolute: file.path,
        fileName: file.fileName,
        fileType: file.fileType,
        extension: file.extension,
        chunkIndex: i + index,
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
        symbol: this.extractSymbol(chunk.text),
        contentHash,
      }));

      await this.vectorStore.add(ids, embeddings, documents, metadata);
      process.stderr.write(`Processed batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(texts.length / batchSize)}\n`);
    }

    await this.vectorStore.upsertIndexedFile({
      filePath: file.relativePath,
      fileHash: contentHash,
      fileSize: file.size,
      modifiedTime: file.modifiedTime,
      fileType: file.fileType,
    });
  }

  private async pruneStaleFiles(dirPath: string, files: LoadedFile[]): Promise<void> {
    const scopePrefix = this.normalizeRelativePath(relative(this.projectContext.path, dirPath));
    const normalizedScope = scopePrefix === "." ? "" : scopePrefix;
    const indexedPaths = await this.vectorStore.listStoredFilePaths(normalizedScope);
    const currentPaths = new Set(files.map((file) => file.relativePath));
    const stalePaths = indexedPaths.filter((filePath) => !currentPaths.has(filePath));

    if (stalePaths.length > 0) {
      process.stderr.write(`Removing ${stalePaths.length} stale file entries\n`);
      await this.vectorStore.deleteByFilePaths(stalePaths);
    }
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
  private async shouldSkipFile(relativePath: string, contentHash: string): Promise<boolean> {
    const indexedFile = await this.vectorStore.getIndexedFile(relativePath);
    return indexedFile?.fileHash === contentHash;
  }

  private extractSymbol(text: string): string | null {
    const symbolPatterns = [
      /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/m,
      /^\s*(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/m,
      /^\s*export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/m,
      /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/m,
      /^\s*export\s+(?:interface|type|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/m,
      /^\s*(?:interface|type|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/m,
      /^\s*export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)/m,
      /^\s*const\s+([A-Za-z_][A-Za-z0-9_]*)/m,
    ];

    for (const pattern of symbolPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Hash file content
   */
  private hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }

  /**
   * Hash file path for generating unique IDs
   */
  private hashFilePath(filePath: string): string {
    return createHash("sha256").update(filePath, "utf8").digest("hex").substring(0, 8);
  }

  private normalizeRelativePath(path: string): string {
    return path.replace(/\\/g, "/");
  }

  close(): void {
    this.vectorStore.close();
  }

}

/**
 * Create an ingestion pipeline from project context and config
 */
export async function createIngestionPipeline(
  projectPath: string,
  config: any // Importing the Config type directly causes circular issues, so we use any
): Promise<IngestionPipeline> {
  const { createProjectContext } = await import("../core/project.js");
  const { createEmbedder } = await import("../core/embedder.js");
  const { SqliteAdapter } = await import("../adapters/sqlite.js");

  const projectContext = await createProjectContext(projectPath);
  const embedder = createEmbedder(config);

  const modelName = config.embedding?.model || "Xenova/all-MiniLM-L6-v2";
  const dimension = modelName.includes("all-MiniLM") ? 384 : 768;

  const vectorStore = new SqliteAdapter(
    projectContext.id,
    projectContext.dbPath,
    dimension
  );

  const chunking = config.chunking || { maxSize: 512, overlap: 50 };

  return new IngestionPipeline(projectContext, embedder, vectorStore, {
    splitter: chunking
  });
}
