import { sanitizePath, generateProjectId, isPathAllowed, PathTraversalError } from "../project.js";
import { join, resolve, sep } from "node:path";

test("sanitizes absolute paths correctly", () => {
  const input = resolve(process.cwd(), "tmp/test");
  const expected = resolve(process.cwd(), "tmp/test");
  expect(sanitizePath(input)).toBe(expected);
});

test("prevents directory traversal with explicit ..", () => {
  expect(() => sanitizePath("../../../etc/passwd")).toThrow(PathTraversalError);
});

test("allows any absolute path without ..", () => {
  const projectOne = resolve(sep, "usr", "local", "project");
  const projectTwo = resolve(sep, "home", "user", "my-project");
  expect(sanitizePath(projectOne)).toBe(projectOne);
  expect(sanitizePath(projectTwo)).toBe(projectTwo);
});

test("allows paths within workspace", () => {
  const workspaceFile = join(process.cwd(), "test.txt");
  expect(isPathAllowed(workspaceFile)).toBe(true);
  expect(isPathAllowed("./subdir/file.ts")).toBe(true);
});

test("blocks paths with explicit ..", () => {
  expect(isPathAllowed("../outside")).toBe(false);
  expect(isPathAllowed("./subdir/../../etc")).toBe(false);
});

test("generates consistent project IDs", () => {
  const path1 = "/test/path";
  const path2 = "/test/path";
  const path3 = "/test/different";
  
  const id1 = generateProjectId(path1);
  const id2 = generateProjectId(path2);
  const id3 = generateProjectId(path3);
  
  expect(id1).toBe(id2); // Same path = same ID
  expect(id1).not.toBe(id3); // Different path = different ID
});

console.log("✓ Project tests passed");
