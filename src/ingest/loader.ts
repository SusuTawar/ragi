// File loader for ingesting documents into the RAG system
import { stat, readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";

/**
 * Supported file extensions for indexing
 * Note: .dockerfile, .gitignore, .env won't match because they have no extension
 * and are also ignored when ignoreHidden is true (default)
 */
const SUPPORTED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown',
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm',
  '.css', '.scss', '.less',
  '.sql', '.sh', '.bash', '.zsh', '.fish',
]);

/**
 * Options for the file loader
 */
export interface LoaderOptions {
  /** File extensions to include (default: SUPPORTED_EXTENSIONS) */
  extensions?: Set<string>;
  /** Whether to ignore hidden files (default: true) */
  ignoreHidden?: boolean;
  /** Custom ignore patterns (supports glob patterns) */
  ignorePatterns?: string[];
  /** Maximum file size in bytes (default: 1MB) */
  maxFileSize?: number;
}

/**
 * Result from loading a file
 */
export interface LoadedFile {
  /** Absolute path to the file */
  path: string;
  /** Relative path from the project root */
  relativePath: string;
  /** File content as string */
  content: string;
  /** File size in bytes */
  size: number;
  /** File extension */
  extension: string;
  /** Last modified timestamp */
  modifiedTime: number;
}

/**
 * Load files from a directory recursively
 * @param directoryPath Absolute path to the directory to load
 * @param projectRoot Absolute path to the project root (for relative paths)
 * @param options Loader options
 * @returns Promise resolving to array of loaded files
 */
export async function loadFiles(
  directoryPath: string,
  projectRoot: string,
  options: LoaderOptions = {}
): Promise<LoadedFile[]> {
  const {
    extensions = SUPPORTED_EXTENSIONS,
    ignoreHidden = true,
    maxFileSize = 1024 * 1024, // 1MB default
    ignorePatterns = []
  } = options;

  const files: LoadedFile[] = [];

  // Load .ragignore if it exists
  const ragignorePath = join(projectRoot, '.ragignore');
  let ragignorePatterns: string[] = [];
  try {
    const ragignoreContent = await readFile(ragignorePath, 'utf-8');
    ragignorePatterns = ragignoreContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    // No .ragignore found
  }

  // Combine with provided ignore patterns
  const allIgnorePatterns = [...ragignorePatterns, ...ignorePatterns];

  const shouldIgnore = (path: string): boolean => {
    const relativePath = relative(projectRoot, path);
    for (const pattern of allIgnorePatterns) {
      // Simple glob matching
      if (pattern === '*') continue;
      if (pattern.endsWith('/') && relativePath.startsWith(pattern.slice(0, -1))) return true;
      if (pattern.startsWith('*') && relativePath.endsWith(pattern.slice(1))) return true;
      if (relativePath === pattern || relativePath.includes('/' + pattern)) return true;
    }
    return false;
  };

  // Walk the directory tree
  const walkDir = async (dir: string): Promise<void> => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        // Skip hidden files if configured (skip .rag* too since we're creating them)
        if (ignoreHidden && entry.name.startsWith('.')) {
          continue;
        }

        // Check ignore patterns
        if (shouldIgnore(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recursively walk subdirectories
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          // Check file extension
          const ext = extname(entry.name).toLowerCase();
          if (!extensions.has(ext)) {
            continue;
          }

          // Check file size
          try {
            const fileStat = await stat(fullPath);
            if (fileStat.size > maxFileSize) {
              console.warn(`Skipping large file: ${fullPath} (${fileStat.size} bytes)`);
              continue;
            }

            // Read file content
            const content = await readFile(fullPath, 'utf-8');
            
            files.push({
              path: fullPath,
              relativePath: relative(projectRoot, fullPath),
              content,
              size: fileStat.size,
              extension: ext,
              modifiedTime: fileStat.mtimeMs
            });
          } catch (err) {
            console.warn(`Could not read file ${fullPath}:`, err);
          }
        }
      }
    } catch (err) {
      console.warn(`Could not read directory ${dir}:`, err);
    }
  };

  await walkDir(directoryPath);
  return files;
}