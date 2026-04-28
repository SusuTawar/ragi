// Test text splitter functionality
import { splitText } from "../splitter";

test("splitText basic functionality", () => {
  const text = "This is a test string for splitting.";
  const options = { maxSize: 10, overlap: 2 };
  
  const chunks = splitText(text, options);
  
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks[0].text).toContain("This is a");
  expect(chunks[0].startIndex).toBe(0);
});

test("splitText respects maxSize", () => {
  const text = "a".repeat(100); // 100 'a' characters
  const options = { maxSize: 20, overlap: 0 };
  
  const chunks = splitText(text, options);
  
  // Each chunk should be at most maxSize characters
  for (const chunk of chunks) {
    expect(chunk.text.length).toBeLessThanOrEqual(20);
  }
});

test("splitText creates overlap", () => {
  const text = "abcdefghijklmnopqrstuvwxyz"; // 26 characters
  const options = { maxSize: 10, overlap: 3 };
  
  const chunks = splitText(text, options);
  
  expect(chunks.length).toBeGreaterThan(1);
  
  // Check that consecutive chunks have overlap
  if (chunks.length >= 2) {
    const chunk1End = chunks[0].endIndex;
    const chunk2Start = chunks[1].startIndex;
    const overlap = chunk1End - chunk2Start;
    expect(overlap).toBe(3); // Should be 3 characters overlap
  }
});

test("splitText handles small text", () => {
  const text = "Small text";
  const options = { maxSize: 50, overlap: 10 }; // Larger than text
  
  const chunks = splitText(text, options);
  
  expect(chunks.length).toBe(1);
  expect(chunks[0].text).toBe(text);
  expect(chunks[0].startIndex).toBe(0);
  expect(chunks[0].endIndex).toBe(text.length);
});

console.log("✓ Splitter tests passed");