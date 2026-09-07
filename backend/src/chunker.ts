export type ChunkMetadata = {
  documentId: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
};

export type DocumentChunk = {
  text: string;
  metadata: ChunkMetadata;
};

type ChunkOptions = {
  maxCharacters?: number;
  overlapCharacters?: number;
};

const splitWords = (text: string) => text.trim().split(/\s+/).filter(Boolean);

const takeOverlap = (text: string, maxCharacters: number) => {
  const words = splitWords(text);
  let result = '';
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const candidate = result ? `${words[index]} ${result}` : words[index];
    if (candidate.length > maxCharacters) {
      break;
    }
    result = candidate;
  }
  return result;
};

const splitLongParagraph = (paragraph: string, maxCharacters: number) => {
  const words = splitWords(paragraph);
  const parts: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maxCharacters) {
      parts.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
};

export function chunkText(documentId: string, text: string, options: ChunkOptions = {}): DocumentChunk[] {
  const maxCharacters = options.maxCharacters ?? 1200;
  const overlapCharacters = options.overlapCharacters ?? 200;
  if (maxCharacters <= 0 || overlapCharacters < 0 || overlapCharacters >= maxCharacters) {
    throw new Error('Chunk overlap must be non-negative and smaller than chunk size');
  }

  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const units = paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, maxCharacters));
  const chunks: DocumentChunk[] = [];
  let current = '';
  let currentStart = 0;
  let sourceCursor = 0;

  const addChunk = (chunkTextValue: string, startChar: number) => {
    const chunkText = chunkTextValue.trim();
    if (!chunkText) {
      return;
    }
    chunks.push({
      text: chunkText,
      metadata: {
        documentId,
        chunkIndex: chunks.length,
        startChar,
        endChar: startChar + chunkText.length,
      },
    });
  };

  for (const unit of units) {
    const unitStart = text.indexOf(unit, sourceCursor);
    const resolvedUnitStart = unitStart >= 0 ? unitStart : sourceCursor;
    sourceCursor = resolvedUnitStart + unit.length;
    const fullCandidate = current ? `${current}\n\n${unit}` : unit;
    if (current && fullCandidate.length > maxCharacters) {
      addChunk(current, currentStart);
      const overlap = takeOverlap(current, Math.min(overlapCharacters, Math.max(0, maxCharacters - unit.length - 2)));
      current = unit;
      if (overlap) {
        current = `${overlap}\n\n${unit}`;
      }
      currentStart = resolvedUnitStart;
    } else {
      if (!current) {
        currentStart = resolvedUnitStart;
      }
      current = fullCandidate;
    }
  }
  addChunk(current, currentStart);

  return chunks;
}
