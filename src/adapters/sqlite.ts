// SQLite adapter using sqlite-vec for vector storage
import Database from "bun:sqlite";
import { load } from "sqlite-vec";
import type { VectorStoreAdapter } from "./base";
import { dirname } from "node:path";
import { access, constants, mkdir } from "node:fs/promises";

export interface IndexedFileRecord {
  filePath: string;
  fileHash: string;
  fileSize: number;
  modifiedTime: number;
  fileType: string;
}

/**
 * SQLite adapter for vector storage using sqlite-vec
 */
export class SqliteAdapter implements VectorStoreAdapter {
  private db!: Database;
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
    if (this.initialized) {
      return;
    }

    const dir = dirname(this.dbPath);
    try {
      await access(dir, constants.F_OK);
    } catch {
      await mkdir(dir, { recursive: true });
    }

    if (process.platform === "darwin") {
      try {
        Database.setCustomSQLite("/opt/homebrew/lib/libsqlite3.dylib");
      } catch (err) {
        process.stderr.write(`Could not set custom SQLite path: ${String(err)}\n`);
      }
    }

    this.db = new Database(this.dbPath);

    try {
      load(this.db);
    } catch (err) {
      throw new Error(`Failed to load sqlite-vec extension: ${err}`);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        content TEXT,
        metadata JSON
      );
    `);

    this.ensureColumn("documents", "file_path", "TEXT");
    this.ensureColumn("documents", "file_name", "TEXT");
    this.ensureColumn("documents", "file_type", "TEXT");
    this.ensureColumn("documents", "symbol", "TEXT");
    this.ensureColumn("documents", "content_hash", "TEXT");

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_project_path
      ON documents(project_id, file_path);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexed_files (
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        modified_time REAL NOT NULL,
        file_type TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, file_path)
      );
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents
      USING vec0(embedding float[${this.dimensionValue}]);
    `);

    this.initialized = true;
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const pragma = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const hasColumn = pragma.some((entry) => entry.name === column);
    if (!hasColumn) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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

    const normalizedMetadata = metadata.length === ids.length
      ? metadata
      : new Array(ids.length).fill({});

    const insertDoc = this.db.prepare(`
      INSERT OR REPLACE INTO documents (
        id,
        project_id,
        content,
        metadata,
        file_path,
        file_name,
        file_type,
        symbol,
        content_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const embedding = embeddings[i]!;
        const document = documents[i]!;
        const docMetadata = normalizedMetadata[i] ?? {};
        const oldRow = this.db.prepare(`SELECT rowid FROM documents WHERE id = ?`).get(id) as { rowid: number } | undefined;

        insertDoc.run(
          id,
          this.projectId,
          document,
          JSON.stringify(docMetadata),
          docMetadata.filePath ?? null,
          docMetadata.fileName ?? null,
          docMetadata.fileType ?? null,
          docMetadata.symbol ?? null,
          docMetadata.contentHash ?? null
        );

        if (oldRow) {
          this.db.prepare(`DELETE FROM vec_documents WHERE rowid = ?`).run(oldRow.rowid);
        }

        const newRow = this.db.prepare(`SELECT rowid FROM documents WHERE id = ?`).get(id) as { rowid: number } | undefined;
        if (newRow) {
          this.db.prepare(`INSERT INTO vec_documents(rowid, embedding) VALUES (?, ?)`).run(
            newRow.rowid,
            new Float32Array(embedding)
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
        d.file_path,
        d.file_name,
        d.file_type,
        d.symbol,
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
    ) as Array<{
      id: string;
      content: string;
      metadata: string | null;
      file_path: string | null;
      file_name: string | null;
      file_type: string | null;
      symbol: string | null;
      distance: number;
    }>;

    return results.map((row) => {
      const parsedMetadata = row.metadata ? JSON.parse(row.metadata) : {};
      return {
        id: row.id,
        document: row.content,
        metadata: {
          ...parsedMetadata,
          filePath: parsedMetadata.filePath ?? row.file_path ?? undefined,
          fileName: parsedMetadata.fileName ?? row.file_name ?? undefined,
          fileType: parsedMetadata.fileType ?? row.file_type ?? undefined,
          symbol: parsedMetadata.symbol ?? row.symbol ?? undefined,
        },
        distance: row.distance,
      };
    });
  }

  async getIndexedFile(filePath: string): Promise<IndexedFileRecord | null> {
    this.assertInitialized();

    const row = this.db.prepare(`
      SELECT file_path, file_hash, file_size, modified_time, file_type
      FROM indexed_files
      WHERE project_id = ? AND file_path = ?
    `).get(this.projectId, filePath) as {
      file_path: string;
      file_hash: string;
      file_size: number;
      modified_time: number;
      file_type: string;
    } | undefined;

    if (!row) return null;

    return {
      filePath: row.file_path,
      fileHash: row.file_hash,
      fileSize: row.file_size,
      modifiedTime: row.modified_time,
      fileType: row.file_type,
    };
  }

  async upsertIndexedFile(record: IndexedFileRecord): Promise<void> {
    this.assertInitialized();

    this.db.prepare(`
      INSERT INTO indexed_files (
        project_id,
        file_path,
        file_hash,
        file_size,
        modified_time,
        file_type,
        indexed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, file_path) DO UPDATE SET
        file_hash = excluded.file_hash,
        file_size = excluded.file_size,
        modified_time = excluded.modified_time,
        file_type = excluded.file_type,
        indexed_at = excluded.indexed_at
    `).run(
      this.projectId,
      record.filePath,
      record.fileHash,
      record.fileSize,
      record.modifiedTime,
      record.fileType,
      Date.now()
    );
  }

  async listIndexedFilePaths(scopePrefix: string = ""): Promise<string[]> {
    this.assertInitialized();

    if (!scopePrefix) {
      const rows = this.db.prepare(`
        SELECT file_path
        FROM indexed_files
        WHERE project_id = ?
      `).all(this.projectId) as Array<{ file_path: string }>;
      return rows.map((row) => row.file_path);
    }

    const prefix = scopePrefix.endsWith("/") ? scopePrefix : `${scopePrefix}/`;
    const rows = this.db.prepare(`
      SELECT file_path
      FROM indexed_files
      WHERE project_id = ? AND (file_path = ? OR file_path LIKE ?)
    `).all(this.projectId, scopePrefix, `${prefix}%`) as Array<{ file_path: string }>;

    return rows.map((row) => row.file_path);
  }

  async listStoredFilePaths(scopePrefix: string = ""): Promise<string[]> {
    this.assertInitialized();

    if (!scopePrefix) {
      const rows = this.db.prepare(`
        SELECT DISTINCT COALESCE(file_path, json_extract(metadata, '$.filePath')) AS resolved_file_path
        FROM documents
        WHERE project_id = ? AND COALESCE(file_path, json_extract(metadata, '$.filePath')) IS NOT NULL
      `).all(this.projectId) as Array<{ resolved_file_path: string }>;
      return rows.map((row) => row.resolved_file_path);
    }

    const prefix = scopePrefix.endsWith("/") ? scopePrefix : `${scopePrefix}/`;
    const rows = this.db.prepare(`
      SELECT DISTINCT COALESCE(file_path, json_extract(metadata, '$.filePath')) AS resolved_file_path
      FROM documents
      WHERE project_id = ?
        AND COALESCE(file_path, json_extract(metadata, '$.filePath')) IS NOT NULL
        AND (
          COALESCE(file_path, json_extract(metadata, '$.filePath')) = ?
          OR COALESCE(file_path, json_extract(metadata, '$.filePath')) LIKE ?
        )
    `).all(this.projectId, scopePrefix, `${prefix}%`) as Array<{ resolved_file_path: string }>;

    return rows.map((row) => row.resolved_file_path);
  }

  async deleteByFilePaths(filePaths: string[]): Promise<void> {
    this.assertInitialized();

    if (filePaths.length === 0) {
      return;
    }

    const placeholders = filePaths.map(() => "?").join(",");
    const getRows = this.db.prepare(`
      SELECT rowid
      FROM documents
      WHERE project_id = ? AND COALESCE(file_path, json_extract(metadata, '$.filePath')) IN (${placeholders})
    `);
    const rows = getRows.all(this.projectId, ...filePaths) as Array<{ rowid: number }>;

    this.db.prepare(`
      DELETE FROM documents
      WHERE project_id = ? AND COALESCE(file_path, json_extract(metadata, '$.filePath')) IN (${placeholders})
    `).run(this.projectId, ...filePaths);

    if (rows.length > 0) {
      const vecPlaceholders = rows.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM vec_documents WHERE rowid IN (${vecPlaceholders})`).run(
        ...rows.map((row) => row.rowid)
      );
    }

    this.db.prepare(`
      DELETE FROM indexed_files
      WHERE project_id = ? AND file_path IN (${placeholders})
    `).run(this.projectId, ...filePaths);
  }

  async delete(ids: string[]): Promise<void> {
    this.assertInitialized();

    const placeholders = ids.map(() => "?").join(",");
    const getRows = this.db.prepare(`SELECT rowid FROM documents WHERE id IN (${placeholders}) AND project_id = ?`);
    const rows = getRows.all(...ids, this.projectId) as Array<{ rowid: number }>;

    this.db.prepare(`DELETE FROM documents WHERE id IN (${placeholders}) AND project_id = ?`).run(...ids, this.projectId);

    if (rows.length > 0) {
      const vecPlaceholders = rows.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM vec_documents WHERE rowid IN (${vecPlaceholders})`).run(
        ...rows.map((row) => row.rowid)
      );
    }
  }

  async clear(): Promise<void> {
    this.assertInitialized();

    this.db.prepare(`DELETE FROM documents WHERE project_id = ?`).run(this.projectId);
    this.db.prepare(`DELETE FROM indexed_files WHERE project_id = ?`).run(this.projectId);
    this.db.prepare(`DELETE FROM vec_documents WHERE rowid NOT IN (SELECT rowid FROM documents)`).run();
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
