import { fileTypeFromBuffer } from 'file-type';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const CHUNK_SIZE_TOKENS = 300;
const CHUNK_OVERLAP_TOKENS = 30;
const CHARS_PER_TOKEN = 4;
const CHUNK_SIZE_CHARS = CHUNK_SIZE_TOKENS * CHARS_PER_TOKEN;
const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

export function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_').slice(0, 100);
}

export async function validateFile(buffer, declaredName) {
  if (!buffer || buffer.length === 0) {
    throw new Error('FILE_EMPTY');
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('FILE_TOO_LARGE');
  }

  const detected = await fileTypeFromBuffer(buffer);
  let mime = detected?.mime;

  if (!mime && declaredName?.toLowerCase().endsWith('.txt')) {
    if (buffer.includes(0x00)) {
      throw new Error('FILE_UNSUPPORTED_TYPE');
    }
    mime = 'text/plain';
  }

  if (!mime || !ALLOWED_MIME.has(mime)) {
    throw new Error('FILE_UNSUPPORTED_TYPE');
  }

  return mime;
}

export async function parseDocument(buffer, mime) {
  if (mime === 'application/pdf') {
    const data = await pdf(buffer);
    return data.text;
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (mime === 'text/plain') {
    return buffer.toString('utf-8');
  }
  throw new Error('FILE_UNSUPPORTED_TYPE');
}

function splitByParagraphs(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function splitBySentences(text) {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function splitBySize(text, size) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

function normalizeUnits(text) {
  const units = [];
  for (const paragraph of splitByParagraphs(text)) {
    if (paragraph.length <= CHUNK_SIZE_CHARS) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of splitBySentences(paragraph)) {
      if (sentence.length <= CHUNK_SIZE_CHARS) {
        units.push(sentence);
      } else {
        units.push(...splitBySize(sentence, CHUNK_SIZE_CHARS));
      }
    }
  }
  return units;
}

export function chunkText(text) {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const units = normalizeUnits(cleaned);
  const chunks = [];
  let current = '';

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    if (current.length + 1 + unit.length <= CHUNK_SIZE_CHARS) {
      current += '\n' + unit;
    } else {
      chunks.push(current);
      const tail = current.slice(-CHUNK_OVERLAP_CHARS);
      current = tail + '\n' + unit;
      if (current.length > CHUNK_SIZE_CHARS) {
        chunks.push(current.slice(0, CHUNK_SIZE_CHARS));
        current = current.slice(CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS);
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export async function ingestFile(buffer, filename) {
  const mime = await validateFile(buffer, filename);
  const text = await parseDocument(buffer, mime);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error('FILE_NO_CONTENT');
  }
  return { chunks, mime, safeName: sanitizeFilename(filename) };
}
