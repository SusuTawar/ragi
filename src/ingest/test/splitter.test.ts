// Test text splitter functionality
import { splitDocument, splitText } from "../splitter.js";

test("splitText basic functionality", () => {
  const text = "This is a test string for splitting.";
  const options = { maxSize: 10, overlap: 2 };

  const chunks = splitText(text, options);

  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks[0].text).toContain("This is a");
  expect(chunks[0].startIndex).toBe(0);
});

test("splitText respects maxSize", () => {
  const text = "a".repeat(100);
  const options = { maxSize: 20, overlap: 0 };

  const chunks = splitText(text, options);

  for (const chunk of chunks) {
    expect(chunk.text.length).toBeLessThanOrEqual(20);
  }
});

test("splitText creates overlap", () => {
  const text = "abcdefghijklmnopqrstuvwxyz";
  const options = { maxSize: 10, overlap: 3 };

  const chunks = splitText(text, options);

  expect(chunks.length).toBeGreaterThan(1);

  if (chunks.length >= 2) {
    const chunk1End = chunks[0].endIndex;
    const chunk2Start = chunks[1].startIndex;
    const overlap = chunk1End - chunk2Start;
    expect(overlap).toBe(3);
  }
});

test("splitText handles small text", () => {
  const text = "Small text";
  const options = { maxSize: 50, overlap: 10 };

  const chunks = splitText(text, options);

  expect(chunks.length).toBe(1);
  expect(chunks[0].text).toBe(text);
  expect(chunks[0].startIndex).toBe(0);
  expect(chunks[0].endIndex).toBe(text.length);
});

test("splitDocument prefers code boundaries for source files", () => {
  const text = [
    "export function first() {",
    "  return 1;",
    "}",
    "",
    "export function second() {",
    "  return 2;",
    "}",
  ].join("\n");

  const chunks = splitDocument(text, { maxSize: 40, overlap: 0 }, { extension: ".ts" });

  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[0].text).toContain("first");
  expect(chunks[1].text).toContain("second");
});
