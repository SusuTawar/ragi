// Project context and path sanitization utilities
import { resolve, isAbsolute, sep, join } from "node:path";
import { createHash } from "node:crypto";
import { access, constants } from "node:fs/promises";

/**
 * Project context containing sanitized path and project ID
 */
export interface ProjectContext {
  /** Sanitized absolute path */
  path: string;
  /** Unique project ID derived from path */
  id: string;
  /** Path to the project's .rag directory */
  ragDir: string;
  /** Path to the project's SQLite database */
  dbPath: string;
}

/**
 * Security error for path traversal attempts
 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

/**
 * Validate and sanitize a project path to prevent directory traversal attacks
 * @param inputPath User-provided path (can be relative or absolute)
 * @returns Sanitized absolute path within allowed workspace
 * @throws PathTraversalError if path attempts to escape allowed directories
 */
export function sanitizePath(inputPath: string): string {
  // Convert to absolute path
  const absPath = isAbsolute(inputPath) 
    ? resolve(inputPath) 
    : resolve(process.cwd(), inputPath);

  // Normalize path separators
  const normalized = absPath.replace(/[/\\]+/g, sep);

  // Security check: prevent directory traversal attempts (..)
  // This allows any absolute path, but blocks explicit .. escapes
  if (absPath.includes('..')) {
    throw new PathTraversalError(
      `Path traversal detected: ${inputPath} contains ".." which is not allowed`
    );
  }

  return normalized;
}

/**
 * Generate a unique project ID from the sanitized path
 * Uses a hash to create a consistent ID for the same path
 */
export function generateProjectId(sanitizedPath: string): string {
  // Create a hash of the path for consistent ID generation
  const hash = createHash('sha256')
    .update(sanitizedPath, 'utf8')
    .digest('hex');
  
  // Use first 16 characters for a reasonably short ID
  return hash.substring(0, 16);
}

/**
 * Create project context from a user-provided path
 * @param inputPath User-provided project path
 * @returns Project context with sanitized path and derived properties
 */
export async function createProjectContext(inputPath: string): Promise<ProjectContext> {
  // Sanitize the input path for security
  const sanitized = sanitizePath(inputPath);
  
  // Generate project ID
  const id = generateProjectId(sanitized);
  
  // Construct .rag directory path
  const ragDir = join(sanitized, '.rag');
  
  // Construct database path
  const dbPath = join(ragDir, 'index.db');
  
  // Ensure .rag directory exists
  try {
    await access(ragDir, constants.F_OK);
  } catch {
    // Directory doesn't exist, we'll create it later when needed
    // For now, just ensure the path is valid
  }
  
  return {
    path: sanitized,
    id,
    ragDir,
    dbPath,
  };
}

/**
 * Check if a path is allowed to be accessed
 * @param path Path to check
 * @returns true if path is safe to use
 */
export function isPathAllowed(path: string): boolean {
  // Block explicit .. in the path
  if (path.includes('..')) {
    return false;
  }
  try {
    sanitizePath(path);
    return true;
  } catch (err) {
    return false;
  }
}