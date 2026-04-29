import { rerankSearchResults } from "../search.js";

test("rerankSearchResults prefers exact source matches over noisy dependency hits", () => {
  const results = rerankSearchResults(
    "copySkill AGENTS",
    [
      {
        id: "1",
        document: "random helper text",
        distance: 0.15,
        metadata: {
          filePath: "node_modules/pkg/index.d.ts",
          fileName: "index.d.ts",
          fileType: "source",
          symbol: "",
        },
      },
      {
        id: "2",
        document: "function copySkill(sourcePath, targetDir, force) {} const AGENTS = {};",
        distance: 0.42,
        metadata: {
          filePath: "scripts/init.mjs",
          fileName: "init.mjs",
          fileType: "source",
          symbol: "copySkill",
        },
      },
    ],
    2
  );

  expect(results[0].id).toBe("2");
});
