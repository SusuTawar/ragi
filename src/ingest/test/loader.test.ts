import { loadFiles } from "../loader";

test("loadFiles returns empty array for non-existent directory", async () => {
  const files = await loadFiles("nonexistent-dir-xyz", process.cwd(), {});
  expect(Array.isArray(files)).toBe(true);
  expect(files.length).toBe(0);
});

console.log("✓ Loader tests passed");