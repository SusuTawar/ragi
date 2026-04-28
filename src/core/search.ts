export interface SearchCandidate {
  id: string;
  document: string;
  distance: number;
  metadata: Record<string, any>;
}

const NOISY_PATH_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".rag",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "target",
  "vendor",
]);

const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;

export function rerankSearchResults(
  query: string,
  candidates: SearchCandidate[],
  limit: number
): SearchCandidate[] {
  const normalizedQuery = query.toLowerCase();
  const queryTokens = tokenize(normalizedQuery);
  const identifierMatches = Array.from(query.matchAll(IDENTIFIER_PATTERN), (match) => match[0]);
  const identifierTokens = identifierMatches.map((token) => token.toLowerCase());
  const uniqueIdentifierTokens = Array.from(new Set(identifierTokens));
  const wantsTests = queryTokens.some((token) => token === "test" || token === "spec");
  const prefersSourceMatches = identifierMatches.some((token) => /[A-Z_]/.test(token));

  return [...candidates]
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, normalizedQuery, queryTokens, uniqueIdentifierTokens, wantsTests, prefersSourceMatches),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.candidate.distance - right.candidate.distance;
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

function scoreCandidate(
  candidate: SearchCandidate,
  normalizedQuery: string,
  queryTokens: string[],
  identifierTokens: string[],
  wantsTests: boolean,
  prefersSourceMatches: boolean
): number {
  const metadata = candidate.metadata ?? {};
  const contentLower = candidate.document.toLowerCase();
  const filePath = String(metadata.filePath ?? "").replace(/\\/g, "/").toLowerCase();
  const fileName = String(metadata.fileName ?? "").toLowerCase();
  const symbol = String(metadata.symbol ?? "").toLowerCase();
  const fileType = String(metadata.fileType ?? "").toLowerCase();

  let score = Math.max(0, 1 - candidate.distance) * 20;

  if (normalizedQuery.length >= 4 && contentLower.includes(normalizedQuery)) {
    score += 18;
  }
  if (normalizedQuery.length >= 4 && filePath.includes(normalizedQuery)) {
    score += 16;
  }

  for (const token of queryTokens) {
    if (token.length < 2) continue;

    if (contentLower.includes(token)) score += 1.5;
    if (filePath.includes(token)) score += 3;
    if (fileName.includes(token)) score += 5;
    if (symbol === token) score += 10;
  }

  for (const token of identifierTokens) {
    const escaped = escapeRegExp(token);
    const identifierRegex = new RegExp(`\\b${escaped}\\b`, "i");

    if (identifierRegex.test(candidate.document)) score += 12;
    if (fileName === token || fileName.startsWith(`${token}.`)) score += 10;
    if (symbol === token) score += 16;
  }

  if (fileType === "source") score += prefersSourceMatches ? 14 : 8;
  else if (fileType === "script") score += 6;
  else if (fileType === "config") score += 4;
  else if (fileType === "docs") score += prefersSourceMatches ? -4 : 2;
  else if (fileType === "test") score += wantsTests ? 4 : 1;

  const pathSegments = filePath.split("/").filter(Boolean);
  if (pathSegments.length > 0) {
    score += Math.max(0, 4 - Math.min(pathSegments.length, 4));
  }

  if (pathSegments.some((segment) => NOISY_PATH_SEGMENTS.has(segment))) {
    score -= 30;
  }

  return score;
}

function tokenize(input: string): string[] {
  return input
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
