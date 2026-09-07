import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { DocumentChunk } from './chunker.js';

type DocumentFormat = 'pdf' | 'docx' | 'txt';

export type ParsedDocument = {
  text: string;
  characterCount: number;
  wordCount: number;
  chunks?: DocumentChunk[];
};

const pageNumberPattern = /^(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;

const isBoundaryLine = (lines: string[], index: number) => {
  const before = lines.slice(Math.max(0, index - 2), index);
  const after = lines.slice(index + 1, index + 3);
  return index < 3 || index >= lines.length - 3 || before.includes('') || after.includes('');
};

const removeRepeatedPageFurniture = (lines: string[]) => {
  const occurrences = new Map<string, number>();
  for (const line of lines) {
    if (line.length > 2 && line.length <= 120) {
      occurrences.set(line, (occurrences.get(line) ?? 0) + 1);
    }
  }

  return lines.filter((line, index) => {
    const count = occurrences.get(line) ?? 0;
    return count < 2 || !isBoundaryLine(lines, index);
  });
};

const normalizeText = (text: string) => {
  const normalizedLines = text
    .normalize('NFKC')
    .replace(/\uFEFF/g, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => !pageNumberPattern.test(line));

  const cleanedLines = removeRepeatedPageFurniture(normalizedLines);
  return cleanedLines
    .join('\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/([^.!?:;])\n(?=[a-z])/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export async function parseDocument(filePath: string, format: DocumentFormat): Promise<ParsedDocument> {
  let text: string;

  if (format === 'txt') {
    text = await fs.readFile(filePath, 'utf8');
  } else if (format === 'docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
  } else {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  }

  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    throw new Error(`No readable text found in ${path.basename(filePath)}`);
  }

  return {
    text: normalizedText,
    characterCount: normalizedText.length,
    wordCount: normalizedText.split(/\s+/).length,
  };
}
