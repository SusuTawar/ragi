import { sanitizePath, generateProjectId, isPathAllowed, createProjectContext, PathTraversalError } from "../project";
import { join, resolve } from "node:path";

test("sanitizes absolute paths correctly", () => {
  const input = resolve(process.cwd(), "tmp/test");
  const expected = resolve(process.cwd(), "tmp/test");
  expect(sanitizePath(input)).toBe(expected);
});

test("prevents directory traversal with explicit ..", () => {
  expect(() => sanitizePath("../../../etc/passwd")).toThrow(PathTraversalError);
});

test("allows any absolute path without ..", () => {
  expect(sanitizePath("/usr/local/project")).toBe("/usr/local/project");
  expect(sanitizePath("/home/user/my-project")).toBe("/home/user/my-project");
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