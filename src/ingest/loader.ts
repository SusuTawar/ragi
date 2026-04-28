// File loader for ingesting documents into the RAG system
import { stat, readdir, readFile } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";

/**
 * Supported file extensions for indexing
 * Note: .dockerfile, .gitignore, .env won't match because they have no extension
 * and are also ignored when ignoreHidden is true (default)
 */
const SUPPORTED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown',
  '.ts', '.tsx', '.js', '.jsx',
  '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm',
  '.css', '.scss', '.less',
  '.sql', '.sh', '.bash', '.zsh', '.fish',
]);

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".rag",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "target",
  "out",
  "vendor",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp",
]);

const SCRIPT_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".fish"]);
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".less"]);
const MARKUP_EXTENSIONS = new Set([".html", ".htm", ".xml"]);
const DATA_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".sql"]);
const DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

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
  /** Root path for built-in ignore matching; defaults to directoryPath */
  rootPath?: string;
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
  /** Classified file type for ranking */
  fileType: FileType;
  /** Basename of the file */
  fileName: string;
}

export type FileType =
  | "source"
  | "script"
  | "config"
  | "docs"
  | "markup"
  | "style"
  | "data"
  | "test"
  | "other";

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function matchesIgnorePattern(relativePath: string, pattern: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(pattern).replace(/^\.\/+/, "");

  if (!normalizedPattern) return false;
  if (normalizedPattern === "*") return true;
  if (normalizedPattern.endsWith("/")) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.startsWith("*")) {
    return normalizedPath.endsWith(normalizedPattern.slice(1));
  }
  return normalizedPath === normalizedPattern || normalizedPath.includes(`/${normalizedPattern}`);
}

function matchesDefaultIgnore(relativePathFromRoot: string): boolean {
  const normalized = normalizeRelativePath(relativePathFromRoot);
  if (!normalized || normalized === ".") return false;

  const segments = normalized.split("/").filter(Boolean);
  return segments.some((segment) => DEFAULT_IGNORED_DIRECTORIES.has(segment));
}

export function classifyFile(relativePath: string, extension: string): FileType {
  const normalizedPath = normalizeRelativePath(relativePath).toLowerCase();
  const fileName = basename(normalizedPath);

  if (normalizedPath.includes("/__tests__/") || normalizedPath.endsWith(".test.ts") || normalizedPath.endsWith(".test.js") || normalizedPath.endsWith(".spec.ts") || normalizedPath.endsWith(".spec.js")) {
    return "test";
  }
  if (SOURCE_EXTENSIONS.has(extension)) return "source";
  if (SCRIPT_EXTENSIONS.has(extension)) return "script";
  if (STYLE_EXTENSIONS.has(extension)) return "style";
  if (MARKUP_EXTENSIONS.has(extension)) return "markup";
  if (DOC_EXTENSIONS.has(extension)) return "docs";
  if (DATA_EXTENSIONS.has(extension)) {
    if (fileName.includes("config") || fileName.startsWith(".")) return "config";
    return "data";
  }
  if (fileName.startsWith(".") || fileName.includes("config")) return "config";
  return "other";
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
    ignorePatterns = [],
    rootPath = directoryPath
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
    const relativePathFromRoot = relative(rootPath, path);

    if (matchesDefaultIgnore(relativePathFromRoot)) {
      return true;
    }

    for (const pattern of allIgnorePatterns) {
      if (matchesIgnorePattern(relativePath, pattern)) {
        return true;
      }
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
              // Avoid stdout; MCP stdio servers must keep stdout clean.
              process.stderr.write(`Skipping large file: ${fullPath} (${fileStat.size} bytes)\n`);
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
              modifiedTime: fileStat.mtimeMs,
              fileType: classifyFile(relative(projectRoot, fullPath), ext),
              fileName: entry.name,
            });
          } catch (err) {
            process.stderr.write(`Could not read file ${fullPath}: ${String(err)}\n`);
          }
        }
      }
    } catch (err) {
      process.stderr.write(`Could not read directory ${dir}: ${String(err)}\n`);
    }
  };

  await walkDir(directoryPath);
  return files;
}
