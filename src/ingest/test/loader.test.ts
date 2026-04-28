import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFiles } from "../loader";

test("loadFiles returns empty array for non-existent directory", async () => {
  const files = await loadFiles("nonexistent-dir-xyz", process.cwd(), {});
  expect(Array.isArray(files)).toBe(true);
  expect(files.length).toBe(0);
});

test("loadFiles ignores noisy directories by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "ragi-loader-"));
  const sourceDir = join(root, "src");
  const depsDir = join(root, "node_modules", "pkg");

  await mkdir(sourceDir, { recursive: true });
  await mkdir(depsDir, { recursive: true });
  await writeFile(join(sourceDir, "index.ts"), "export const value = 1;");
  await writeFile(join(depsDir, "index.js"), "module.exports = {};");

  const files = await loadFiles(root, root, {});

  expect(files.map((file) => file.relativePath.replace(/\\/g, "/"))).toEqual(["src/index.ts"]);
});

test("loadFiles indexes mjs files and classifies them as source", async () => {
  const root = await mkdtemp(join(tmpdir(), "ragi-loader-mjs-"));
  await writeFile(join(root, "tool.mjs"), "export function tool() {}");

  const files = await loadFiles(root, root, {});

  expect(files).toHaveLength(1);
  expect(files[0].extension).toBe(".mjs");
  expect(files[0].fileType).toBe("source");
});
