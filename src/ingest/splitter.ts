// Text splitter for chunking documents into smaller pieces for embedding

/**
 * Options for text splitting
 */
export interface SplitterOptions {
  /** Maximum chunk size in tokens (approximate) */
  maxSize: number;
  /** Overlap between chunks in tokens */
  overlap: number;
  /** Whether to split recursively by separators */
  recursive?: boolean;
  /** Custom separators for recursive splitting */
  separators?: string[];
}

/**
 * Result from splitting text
 */
export interface TextChunk {
  /** The text content of the chunk */
  text: string;
  /** Start index in the original text */
  startIndex: number;
  /** End index in the original text */
  endIndex: number;
}

/**
 * Split text into chunks based on configuration
 * @param text The text to split
 * @param options Splitting options
 * @returns Array of text chunks
 */
export function splitText(
  text: string,
  options: SplitterOptions
): TextChunk[] {
  const {
    maxSize = 512,
    overlap = 50,
    recursive = true,
    separators = ["\n\n", "\n", " ", ""]
  } = options;

  if (recursive) {
    return splitTextRecursive(text, maxSize, overlap, separators);
  } else {
    return splitTextFixed(text, maxSize, overlap);
  }
}

/**
 * Split text using fixed-size chunks with overlap
 */
function splitTextFixed(
  text: string,
  maxSize: number,
  overlap: number
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length);
    const chunkText = text.slice(start, end);
    
    chunks.push({
      text: chunkText,
      startIndex: start,
      endIndex: end
    });
    
    // Move start forward by (maxSize - overlap) for overlap
    start += Math.max(1, maxSize - overlap);
    
    // Break if we've reached the end
    if (end >= text.length) break;
  }
  
  return chunks;
}

/**
 * Split text recursively using separators to keep related text together
 */
function splitTextRecursive(
  text: string,
  maxSize: number,
  overlap: number,
  separators: string[]
): TextChunk[] {
  // If text is small enough, return as single chunk
  if (text.length <= maxSize) {
    return [{
      text,
      startIndex: 0,
      endIndex: text.length
    }];
  }

  // Try to split by each separator in order
  for (const separator of separators) {
    if (separator === "") {
      // Fallback to character-level splitting
      return splitTextFixed(text, maxSize, overlap);
    }
    
    if (text.includes(separator)) {
      const splits = text.split(separator);
      const chunks: TextChunk[] = [];
      let currentIndex = 0;
      
      for (let i = 0; i < splits.length; i++) {
        const split = splits[i];
        const splitWithSep = i < splits.length - 1 ? split + separator : split;
        const splitLength = splitWithSep.length;
        
        // If adding this split would exceed maxSize, create a chunk
        if (chunks.length === 0 || 
            chunks[chunks.length - 1].text.length + splitLength > maxSize) {
          
          // If we have text in the current chunk, finalize it
          if (chunks.length > 0 && chunks[chunks.length - 1].text.length > 0) {
            // Add overlap from previous chunk if configured
            if (overlap > 0 && chunks.length > 0) {
              const prevChunk = chunks[chunks.length - 1];
              const overlapText = prevChunk.text.slice(-overlap);
              chunks.push({
                text: overlapText + splitWithSep,
                startIndex: currentIndex - overlapText.length,
                endIndex: currentIndex - overlapText.length + overlapText.length + splitLength
              });
            } else {
              chunks.push({
                text: splitWithSep,
                startIndex: currentIndex,
                endIndex: currentIndex + splitLength
              });
            }
          } else {
            // First chunk or empty previous chunk
            chunks.push({
              text: splitWithSep,
              startIndex: currentIndex,
              endIndex: currentIndex + splitLength
            });
          }
          
          // Reset for next chunk
          currentIndex += splitLength;
        } else {
          // Add to current chunk
          if (chunks.length > 0) {
            const lastChunk = chunks[chunks.length - 1];
            lastChunk.text += splitWithSep;
            lastChunk.endIndex = currentIndex + splitLength;
          } else {
            chunks.push({
              text: splitWithSep,
              startIndex: currentIndex,
              endIndex: currentIndex + splitLength
            });
          }
          
          currentIndex += splitLength;
        }
      }
      
      // Handle overlap between chunks
      if (overlap > 0 && chunks.length > 1) {
        for (let i = 1; i < chunks.length; i++) {
          const prevChunk = chunks[i - 1];
          const currChunk = chunks[i];
          
          // Get overlap from end of previous chunk
          const overlapText = prevChunk.text.slice(-Math.min(overlap, prevChunk.text.length));
          
          // Prepend overlap to current chunk if not already there
          if (!currChunk.text.startsWith(overlapText)) {
            currChunk.text = overlapText + currChunk.text;
            currChunk.startIndex = Math.max(0, currChunk.startIndex - overlapText.length);
          }
        }
      }
      
      return chunks;
    }
  }
  
  // If no separator worked, fall back to fixed splitting
  return splitTextFixed(text, maxSize, overlap);
}

/**
 * Split markdown text respecting block structure
 */
export function splitMarkdown(
  text: string,
  options: SplitterOptions
): TextChunk[] {
  const {
    maxSize = 512,
    overlap = 50
  } = options;
  
  // First try to split by markdown blocks
  const blocks = splitMarkdownBlocks(text);
  const chunks: TextChunk[] = [];
  let currentChunk = { text: "", startIndex: 0, endIndex: 0 };
  
  for (const block of blocks) {
    // If adding this block would exceed maxSize, finalize current chunk
    if (currentChunk.text.length + block.length > maxSize && currentChunk.text.length > 0) {
      chunks.push({ ...currentChunk });
      
      // Start new chunk with overlap
      if (overlap > 0 && currentChunk.text.length > 0) {
        const overlapText = currentChunk.text.slice(-Math.min(overlap, currentChunk.text.length));
        currentChunk = {
          text: overlapText + block,
          startIndex: currentChunk.endIndex - overlapText.length,
          endIndex: currentChunk.endIndex - overlapText.length + overlapText.length + block.length
        };
      } else {
        currentChunk = {
          text: block,
          startIndex: currentChunk.endIndex,
          endIndex: currentChunk.endIndex + block.length
        };
      }
    } else {
      // Add block to current chunk
      if (currentChunk.text.length === 0) {
        const startIdx = chunks.reduce((sum, ch) => sum + (ch.endIndex - ch.startIndex), 0);
        currentChunk = {
          text: block,
          startIndex: startIdx,
          endIndex: startIdx + block.length
        };
      } else {
        currentChunk.text += block;
        currentChunk.endIndex += block.length;
      }
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.text.length > 0) {
    chunks.push({ ...currentChunk });
  }
  
  // If any chunk is still too large, split it further
  const finalChunks: TextChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.text.length <= maxSize) {
      finalChunks.push(chunk);
    } else {
      // Recursively split oversized chunks
      const subChunks = splitText(chunk.text, { 
        maxSize, 
        overlap, 
        recursive: true,
        separators: ["\n\n", "\n", " ", ""]
      });
      
      // Adjust indices to match original text
      for (const subChunk of subChunks) {
        finalChunks.push({
          ...subChunk,
          startIndex: subChunk.startIndex + chunk.startIndex,
          endIndex: subChunk.endIndex + chunk.startIndex
        });
      }
    }
  }
  
  return finalChunks;
}

/**
 * Split text into markdown-like blocks (headers, paragraphs, lists, code blocks)
 */
function splitMarkdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  let currentBlock = "";
  let inCodeBlock = false;
  let codeBlockLanguage = "";
  
  const lines = text.split("\n");
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Handle code blocks
    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        // Starting code block
        if (currentBlock.trim()) {
          blocks.push(currentBlock);
          currentBlock = "";
        }
        inCodeBlock = true;
        codeBlockLanguage = line.trim().slice(3).trim();
        currentBlock = line + "\n";
      } else {
        // Ending code block
        currentBlock += line + "\n";
        blocks.push(currentBlock);
        currentBlock = "";
        inCodeBlock = false;
        codeBlockLanguage = "";
      }
      continue;
    }
    
    if (inCodeBlock) {
      currentBlock += line + "\n";
      continue;
    }
    
    // Check for header (starting with #)
    if (line.match(/^#{1,6}\s+/)) {
      if (currentBlock.trim()) {
        blocks.push(currentBlock);
        currentBlock = "";
      }
      currentBlock = line + "\n";
    } 
    // Check for horizontal rule
    else if (line.match(/^[-*_]{3,}\s*$/)) {
      if (currentBlock.trim()) {
        blocks.push(currentBlock);
        currentBlock = "";
      }
      blocks.push(line + "\n");
      currentBlock = "";
    }
    // Check for list items
    else if (line.match(/^[\s]*[-*+]\s+/) || line.match(/^[\s]*\d+\.\s+/)) {
      if (currentBlock.trim() && !currentBlock.trim().match(/^[\s]*[-*+]\s+/) && !currentBlock.trim().match(/^[\s]*\d+\.\s+/)) {
        blocks.push(currentBlock);
        currentBlock = "";
      }
      currentBlock += line + "\n";
    }
    // Regular paragraph line or empty line
    else {
      currentBlock += line + "\n";
      
      // Double newline indicates paragraph break
      if (line.trim() === "" && i < lines.length - 1 && lines[i + 1].trim() === "") {
        if (currentBlock.trim()) {
          blocks.push(currentBlock);
          currentBlock = "";
        }
        // Skip the next empty line as we've already added it
        i++;
      }
    }
  }
  
  // Add remaining block
  if (currentBlock.trim()) {
    blocks.push(currentBlock);
  }
  
  return blocks.filter(block => block.trim().length > 0);
}