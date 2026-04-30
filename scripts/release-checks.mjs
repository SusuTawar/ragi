import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const packageJsonPath = resolve(repoRoot, "package.json");
const initScriptPath = resolve(repoRoot, "scripts", "init.mjs");
const serverPath = resolve(repoRoot, "src", "mcp", "server.ts");
const builtServerPath = resolve(repoRoot, "dist", "mcp", "server.js");
const changelogPath = resolve(repoRoot, "CHANGELOG.md");
const npmCachePath = resolve(repoRoot, ".tmp", "npm-cache");

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const npmCliPath =
  process.platform === "win32"
    ? resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : null;

function fail(message) {
  console.error(`release-checks: ${message}`);
  process.exit(1);
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function readPackageJson() {
  return JSON.parse(readText(packageJsonPath));
}

function extractVersion(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) {
    fail(`could not find version in ${label}`);
  }
  return match[1];
}

function getVersions() {
  const pkg = readPackageJson();
  const initVersion = extractVersion(
    readText(initScriptPath),
    /const PKG_VERSION = ['"]([^'"]+)['"]/,
    "scripts/init.mjs"
  );
  const serverVersion = extractVersion(
    readText(serverPath),
    /version:\s*["']([^"']+)["']/,
    "src/mcp/server.ts"
  );

  return {
    packageVersion: pkg.version,
    initVersion,
    serverVersion,
  };
}

function assertSemver(version, label) {
  if (!semverPattern.test(version)) {
    fail(`${label} is not valid semver: ${version}`);
  }
}

function assertVersionConsistency() {
  const { packageVersion, initVersion, serverVersion } = getVersions();

  assertSemver(packageVersion, "package.json version");
  assertSemver(initVersion, "scripts/init.mjs version");
  assertSemver(serverVersion, "src/mcp/server.ts version");

  const versions = new Set([packageVersion, initVersion, serverVersion]);
  if (versions.size !== 1) {
    fail(
      `version mismatch detected: package.json=${packageVersion}, scripts/init.mjs=${initVersion}, src/mcp/server.ts=${serverVersion}`
    );
  }

  console.log(`Version consistency OK: ${packageVersion}`);
  return packageVersion;
}

function extractChangelogSection(version) {
  const changelog = readText(changelogPath);
  const headingPattern = new RegExp(
    `^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?:\\s+-\\s+.+)?$`,
    "m"
  );
  const headingMatch = changelog.match(headingPattern);

  if (!headingMatch || headingMatch.index === undefined) {
    fail(`CHANGELOG.md is missing a section for version ${version}`);
  }

  const start = headingMatch.index;
  const rest = changelog.slice(start);
  const nextMatch = rest.slice(headingMatch[0].length).match(/\n## \[/);
  const end = nextMatch ? start + headingMatch[0].length + nextMatch.index + 1 : changelog.length;
  return changelog.slice(start, end).trim();
}

function assertChangelog(version) {
  const section = extractChangelogSection(version);
  if (!/\n- /.test(`${section}\n`)) {
    fail(`CHANGELOG.md section for version ${version} must contain at least one bullet item`);
  }

  console.log(`Changelog entry OK for ${version}`);
  return section;
}

function assertPackageMetadata() {
  const pkg = readPackageJson();
  const requiredFields = ["name", "version", "description", "license", "repository", "bin", "files", "engines"];

  for (const field of requiredFields) {
    if (!(field in pkg)) {
      fail(`package.json is missing required field "${field}"`);
    }
  }

  if (pkg.name !== "@susutawar/ragi") {
    fail(`package name must remain "@susutawar/ragi" for release workflow, received "${pkg.name}"`);
  }

  if (!pkg.bin.ragi) {
    fail('package.json bin must expose "ragi"');
  }

  if (pkg.engines.node !== ">=22") {
    fail(`package.json engines.node must be \">=22\", received "${pkg.engines.node}"`);
  }

  const requiredPublishedPaths = ["CHANGELOG.md", "bin", "dist", "scripts", "skills"];
  for (const path of requiredPublishedPaths) {
    if (!pkg.files.includes(path)) {
      fail(`package.json files must include "${path}"`);
    }
  }

  if (pkg.files.includes("src")) {
    fail('package.json files must not publish raw "src" TypeScript files');
  }

  console.log("Package metadata OK");
}

function assertBuildArtifacts() {
  if (!existsSync(builtServerPath)) {
    fail("built server artifact is missing at dist/mcp/server.js. Run `npm run build` first.");
  }

  console.log("Build artifacts OK");
}

function resolveGitExecutable() {
  return process.platform === "win32" ? "git.exe" : "git";
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...options.env },
    shell: options.shell ?? false,
  });

  if (result.error) {
    fail(`failed to run ${command} ${args.join(" ")}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    if (options.stdio === "inherit") {
      process.exit(result.status ?? 1);
    }

    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    fail(
      `${command} ${args.join(" ")} exited with code ${result.status}${
        stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : ""
      }`
    );
  }

  return result;
}

function runNpmCommand(args, options = {}) {
  const env = { npm_config_cache: npmCachePath, ...options.env };

  try {
    if (process.platform === "win32") {
      if (!npmCliPath || !existsSync(npmCliPath)) {
        fail(`could not find npm CLI at ${npmCliPath ?? "unknown path"}`);
      }

      return runCommand(process.execPath, [npmCliPath, ...args], { ...options, env });
    }

    return runCommand("npm", args, { ...options, env });
  } finally {
    rmSync(resolve(repoRoot, ".tmp"), { recursive: true, force: true });
  }
}

function runNpmScript(scriptName) {
  runNpmCommand(["run", scriptName], { stdio: "inherit" });
}

function assertPackDryRun() {
  const result = runNpmCommand(["pack", "--dry-run", "--json"]);
  let payload;

  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    fail(`could not parse npm pack output as JSON: ${error.message}`);
  }

  const packInfo = Array.isArray(payload) ? payload[0] : payload;
  if (!packInfo?.files || !Array.isArray(packInfo.files)) {
    fail("npm pack --dry-run did not return file metadata");
  }

  const packedFiles = new Set(packInfo.files.map((file) => file.path));
  const requiredFiles = [
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "bin/ragi.js",
    "scripts/init.mjs",
    "scripts/release-checks.mjs",
    "dist/mcp/server.js",
    "dist/adapters/sqlite.js",
    "skills/ragi/SKILL.md",
  ];

  for (const file of requiredFiles) {
    if (!packedFiles.has(file)) {
      fail(`npm pack output is missing expected file: ${file}`);
    }
  }

  console.log(`Package dry run OK: ${packInfo.files.length} files`);
  return packInfo;
}

function assertCleanGitState() {
  const result = runCommand(resolveGitExecutable(), ["status", "--porcelain"]);
  const dirtyEntries = result.stdout.trim();

  if (dirtyEntries.length > 0) {
    fail(`git working tree must be clean before release preparation or publish\n${dirtyEntries}`);
  }

  console.log("Git working tree is clean");
}

function assertMainBranch() {
  const result = runCommand(resolveGitExecutable(), ["branch", "--show-current"]);
  const branch = result.stdout.trim();

  if (branch !== "main") {
    fail(`release publishing must run from main, current branch is "${branch || "unknown"}"`);
  }

  console.log("Release branch OK: main");
}

function validateRelease() {
  const version = assertVersionConsistency();
  assertChangelog(version);
  assertPackageMetadata();
  assertBuildArtifacts();
  assertPackDryRun();
}

function publishRelease() {
  assertMainBranch();
  assertCleanGitState();
  runNpmScript("check");
  runNpmCommand(["publish", "--access", "public"], { stdio: "inherit" });

  const version = readPackageJson().version;
  console.log("");
  console.log(`Published @susutawar/ragi@${version} to npm.`);
  console.log(`Next steps: git tag v${version} && git push origin v${version}`);
  console.log(`Then create a GitHub release using the CHANGELOG.md entry for ${version}.`);
}

function printVersion() {
  process.stdout.write(`${readPackageJson().version}\n`);
}

function printReleaseNotes() {
  const version = readPackageJson().version;
  process.stdout.write(`${extractChangelogSection(version)}\n`);
}

const command = process.argv[2] ?? "validate";

switch (command) {
  case "validate":
    validateRelease();
    break;
  case "assert-clean":
    assertCleanGitState();
    break;
  case "assert-main":
    assertMainBranch();
    break;
  case "pack-dry-run":
    assertPackDryRun();
    break;
  case "publish":
    publishRelease();
    break;
  case "version":
    printVersion();
    break;
  case "notes":
    printReleaseNotes();
    break;
  default:
    fail(`unknown command "${command}"`);
}
