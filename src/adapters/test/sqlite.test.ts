import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteAdapter } from "../sqlite.js";

test("SqliteAdapter can add and search documents with node:sqlite", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ragi-sqlite-test-"));
  const dbPath = join(tempDir, "index.db");
  const adapter = new SqliteAdapter("test-project", dbPath, 3);

  try {
    await adapter.init();
    await adapter.add(
      ["doc-1"],
      [[1, 0, 0]],
      ["release smoke test content"],
      [{ filePath: "sample.txt", fileName: "sample.txt", fileType: "text" }]
    );

    const results = await adapter.search([1, 0, 0], 1);

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("doc-1");
    expect(results[0]?.document).toContain("release smoke test content");
    expect(results[0]?.metadata.filePath).toBe("sample.txt");
  } finally {
    adapter.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
