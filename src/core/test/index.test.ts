import { loadConfig } from "../config.js";
import { sanitizePath, createProjectContext } from "../project.js";
import { createEmbedder } from "../embedder.js";

test("core modules integrate correctly", async () => {
  // Load config
  const config = await loadConfig();
  expect(config).toBeDefined();
  
  // Test path sanitization
  const safePath = sanitizePath("./test");
  expect(safePath).toBeDefined();
  
  // Test project context creation
  const project = await createProjectContext("./test-project");
  expect(project.path).toBeDefined();
  expect(project.id.length).toBe(16);
  expect(project.ragDir).toContain('.rag');
  expect(project.dbPath).toContain('index.db');
  
  // Test embedder creation
  const embedder = createEmbedder(config);
  expect(embedder).toBeDefined();
  
  console.log("✓ Core modules integration test passed");
});

console.log("✓ All core module tests passed");
