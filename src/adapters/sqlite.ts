// SQLite adapter using sqlite-vec for vector storage
import Database from "bun:sqlite";
import { load } from "sqlite-vec";
import { VectorStoreAdapter } from "./base";
import { join } from "node:path";
import { access, constants, mkdir } from "node:fs/promises";

/**
 * SQLite adapter for vector storage using sqlite-vec
 */
export class SqliteAdapter implements VectorStoreAdapter {
  private db: Database;
  private readonly projectId: string;
  private readonly dbPath: string;
  private readonly dimensionValue: number;
  private initialized = false;

  constructor(projectId: string, dbPath: string, dimension: number = 384) {
    this.projectId = projectId;
    this.dbPath = dbPath;
    this.dimensionValue = dimension;
  }

async init(): Promise<void> {
    // Ensure directory exists
    const dir = join(this.dbPath, '..');
    try {
      await access(dir, constants.F_OK);
    } catch {
      await mkdir(dir, { recursive: true });
    }
    
    // Handle macOS SQLite restrictions if needed - MUST be before opening DB
    if (process.platform === "darwin") {
      try {
        // Try to use Homebrew's SQLite if available
        Database.setCustomSQLite("/opt/homebrew/lib/libsqlite3.dylib");
      } catch (err) {
        console.warn("Could not set custom SQLite path:", err);
        // Continue with default SQLite
      }
    }
    
    // Open database connection
    this.db = new Database(this.dbPath);
    
    // Load sqlite-vec extension
    try {
      load(this.db);
    } catch (err) {
      throw new Error(`Failed to load sqlite-vec extension: ${err}`);
    }

    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        content TEXT,
        metadata JSON
      );
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents 
      USING vec0(embedding float[${this.dimensionValue}]);
    `);

    this.initialized = true;
  }

  private assertInitialized() {
    if (!this.initialized) {
      throw new Error("Adapter not initialized. Call init() first.");
    }
  }

  async add(
    ids: string[],
    embeddings: number[][],
    documents: string[],
    metadata: Record<string, any>[] = []
  ): Promise<void> {
    this.assertInitialized();

    if (ids.length !== embeddings.length || ids.length !== documents.length) {
      throw new Error("Ids, embeddings, and documents arrays must have equal length");
    }

    // Ensure metadata array matches length
    const normalizedMetadata = metadata.length === ids.length 
      ? metadata 
      : new Array(ids.length).fill({});

    const insertDoc = this.db.prepare(`
      INSERT OR REPLACE INTO documents (id, project_id, content, metadata)
      VALUES (?, ?, ?, ?)
    `);

    // Transaction for better performance
    this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        // Get old rowid before replacement (if exists)
        const oldRow = this.db.prepare(`SELECT rowid FROM documents WHERE id = ?`).get(ids[i]) as { rowid: number } | undefined;
        
        // Insert document
        insertDoc.run(
          ids[i],
          this.projectId,
          documents[i],
          JSON.stringify(normalizedMetadata[i])
        );
        
        // If there was an old document, delete its vector BEFORE the new insert gets a new rowid
        if (oldRow) {
          this.db.prepare(`DELETE FROM vec_documents WHERE rowid = ?`).run(oldRow.rowid);
        }
        
        // Insert vector with new rowid
        const newRow = this.db.prepare(`SELECT rowid FROM documents WHERE id = ?`).get(ids[i]) as { rowid: number };
        if (newRow) {
          this.db.prepare(`INSERT INTO vec_documents(rowid, embedding) VALUES (?, ?)`).run(
            newRow.rowid,
            new Float32Array(embeddings[i])
          );
        }
      }
    })();
  }

  async search(
    queryEmbedding: number[],
    limit: number = 10
  ): Promise<Array<{ id: string; distance: number; document: string; metadata: Record<string, any> }>> {
    this.assertInitialized();

    const query = this.db.prepare(`
      SELECT
        d.id,
        d.content,
        d.metadata,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM vec_documents v
      JOIN documents d ON v.rowid = d.rowid
      WHERE d.project_id = ?
      ORDER BY distance
      LIMIT ?
    `);

    const results = query.all(
      new Float32Array(queryEmbedding),
      this.projectId,
      limit
    );

    return results.map((row: any) => ({
      id: row.id,
      document: row.content,
      metadata: JSON.parse(row.metadata),
      distance: row.distance
    }));
  }

  async delete(ids: string[]): Promise<void> {
    this.assertInitialized();

    const placeholders = ids.map(() => "?").join(",");
    
    // Delete documents first (need to get rowids for vector cleanup)
    const getRows = this.db.prepare(`SELECT rowid FROM documents WHERE id IN (${placeholders}) AND project_id = ?`);
    const rows = getRows.all(...ids, this.projectId) as { rowid: number }[];
    
    // Delete documents
    const deleteDoc = this.db.prepare(`DELETE FROM documents WHERE id IN (${placeholders}) AND project_id = ?`);
    deleteDoc.run(...ids, this.projectId);
    
    // Delete vectors directly (no cascade relationship exists)
    if (rows.length > 0) {
      const vecPlaceholders = rows.map(() => "?").join(",");
      const deleteVecs = this.db.prepare(`DELETE FROM vec_documents WHERE rowid IN (${vecPlaceholders})`);
      deleteVecs.run(...rows.map(r => r.rowid));
    }
  }

  async clear(): Promise<void> {
    this.assertInitialized();

    // Delete all documents for this project (must delete both tables!)
    const clearDocs = this.db.prepare(`DELETE FROM documents WHERE project_id = ?`);
    clearDocs.run(this.projectId);
    
    // Also delete vectors directly since there's no cascade
    const clearVecs = this.db.prepare(`DELETE FROM vec_documents WHERE rowid NOT IN (SELECT rowid FROM documents)`);
    clearVecs.run();
  }

  dimension(): number {
    return this.dimensionValue;
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}