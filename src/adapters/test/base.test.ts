// Tests for the base adapter interface
import { SqliteAdapter } from "../sqlite.js";

test("SqliteAdapter can be instantiated", () => {
  const adapter = new SqliteAdapter("test-project", ":memory:", 384);
  expect(adapter).toBeDefined();
});

test("SqliteAdapter has required methods", async () => {
  const adapter = new SqliteAdapter("test-project", ":memory:", 384);
  
  expect(typeof adapter.init).toBe('function');
  expect(typeof adapter.add).toBe('function');
  expect(typeof adapter.search).toBe('function');
  expect(typeof adapter.delete).toBe('function');
  expect(typeof adapter.clear).toBe('function');
  expect(typeof adapter.dimension).toBe('function');
});

test("SqliteAdapter reports correct dimension", () => {
  const adapter = new SqliteAdapter("test-project", ":memory:", 384);
  expect(adapter.dimension()).toBe(384);
});

console.log("✓ Base adapter tests passed");
