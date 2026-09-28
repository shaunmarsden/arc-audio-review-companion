import * as pdfjsLib from 'pdfjs-dist';
import * as mammoth from 'mammoth/mammoth.browser';
import type { DocChunk } from '../dummyData';

// Turns an uploaded PDF, DOCX, Markdown or text file into listenable sections.
// Headings become section titles; long sections are split into "(cont.)" parts.

const MAX_WORDS = 250;

// guess: 'weak' = short line with no punctuation, 'bold' = a paragraph that is entirely bold.
interface Block { heading?: string; text?: string; guess?: 'weak' | 'bold' }

// Guessed headings only count when real text follows; otherwise they're kept as text,
// so things like flattened table cells are never mistaken for empty sections and dropped.
function resolveGuesses(blocks: Block[]): Block[] {
  return blocks.map((b, i) => {
    if (!b.guess) return b;
    const next = blocks[i + 1];
    const keep = b.guess === 'bold'
      ? !!next && !(next.heading && !next.guess) && next.guess !== 'bold'
      : !!next && next.text !== undefined && !next.guess;
    return keep ? { heading: b.heading } : { text: b.heading };
  });
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function blocksToChunks(blocks: Block[], fallbackTitle: string): DocChunk[] {
  const sections: { title: string; paras: string[] }[] = [];
  for (const b of resolveGuesses(blocks)) {
    if (b.heading) {
      sections.push({ title: b.heading, paras: [] });
    } else if (b.text?.trim()) {
      if (sections.length === 0) sections.push({ title: fallbackTitle, paras: [] });
      sections[sections.length - 1].paras.push(b.text.trim());
    }
  }

  const chunks: DocChunk[] = [];
  let pendingTitle = '';
  for (const section of sections) {
    // A heading followed directly by another heading (e.g. a title over a subtitle) is folded into the next one.
    if (section.paras.length === 0) {
      pendingTitle = pendingTitle ? `${pendingTitle} – ${section.title}` : section.title;
      continue;
    }
    if (pendingTitle) {
      section.title = `${pendingTitle} – ${section.title}`;
      pendingTitle = '';
    }
    let current: string[] = [];
    let words = 0;
    let part = 0;
    const flush = () => {
      if (current.length === 0) return;
      chunks.push({
        id: `u${chunks.length + 1}`,
        section: part === 0 ? section.title : `${section.title} (cont.)`,
        text: current.join('\n\n'),
      });
      part++;
      current = [];
      words = 0;
    };
    for (const para of section.paras) {
      const w = wordCount(para);
      if (words > 0 && words + w > MAX_WORDS) flush();
      current.push(para);
      words += w;
    }
    flush();
  }
  return chunks;
}

function tableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.rows).map(r =>
    Array.from(r.cells).map(c => (c.textContent || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim())
  ).filter(r => r.some(Boolean));
  if (rows.length === 0) return '';
  if (rows.length === 1 && rows[0].length === 1) return rows[0][0];
  const width = Math.max(...rows.map(r => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] || '').join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

function htmlToBlocks(html: string): Block[] {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const blocks: Block[] = [];
  const walk = (el: Element) => {
    for (const node of Array.from(el.children)) {
      const tag = node.tagName.toLowerCase();
      if (/^h[1-4]$/.test(tag)) blocks.push({ heading: (node.textContent || '').trim() });
      else if (tag === 'p') {
        // Word files often fake headings with bold or short lines rather than heading styles.
        const text = (node.textContent || '').trim();
        const isBoldOnly = node.children.length === 1 && node.firstElementChild?.tagName === 'STRONG' && (node.firstElementChild.textContent || '').trim() === text;
        if (text && isBoldOnly && wordCount(text) <= 12) blocks.push({ heading: text, guess: 'bold' });
        else if (looksLikeHeading(text)) blocks.push({ heading: text, guess: 'weak' });
        else blocks.push({ text });
      }
      else if (tag === 'ul' || tag === 'ol') {
        blocks.push({ text: Array.from(node.children).map(li => `- ${(li.textContent || '').trim()}`).join('\n') });
      } else if (tag === 'table') blocks.push({ text: tableToMarkdown(node as HTMLTableElement) });
      else walk(node);
    }
  };
  walk(dom.body);
  return blocks.filter(b => b.heading || b.text?.trim());
}

// Short standalone line with no closing punctuation, not a list item or table row.
function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length < 70 && wordCount(t) <= 10
    && !/[.,;:!?)]$/.test(t) && !/^([-*•|>]|\d+[.)])/.test(t);
}

function textToBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const para of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    let buffer: string[] = [];
    const flushText = () => {
      if (buffer.length) blocks.push({ text: buffer.join('\n') });
      buffer = [];
    };
    for (const raw of para.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const md = line.match(/^#{1,4}\s+(.+)$/);
      if (md || (buffer.length === 0 && looksLikeHeading(line))) {
        flushText();
        blocks.push(md ? { heading: md[1].trim() } : { heading: line, guess: 'weak' });
      } else {
        buffer.push(line);
      }
    }
    flushText();
  }
  return blocks;
}

async function pdfToText(file: File): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    let pageText = '';
    for (const item of content.items as any[]) {
      pageText += item.str + (item.hasEOL ? '\n' : ' ');
    }
    pages.push(pageText);
  }
  // PDFs rarely mark paragraphs; treat a line ending in a full stop as a paragraph break.
  return pages.join('\n\n').normalize('NFKC').replace(/([.!?])\s*\n/g, '$1\n\n').replace(/[ \t]+/g, ' ');
}

export async function fileToChunks(file: File): Promise<{ title: string; chunks: DocChunk[] }> {
  const title = file.name.replace(/\.[^.]+$/, '');
  const name = file.name.toLowerCase();
  let blocks: Block[];

  if (name.endsWith('.docx')) {
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    blocks = htmlToBlocks(value);
  } else if (name.endsWith('.pdf')) {
    blocks = textToBlocks(await pdfToText(file));
  } else if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown') || file.type.startsWith('text/')) {
    blocks = textToBlocks(await file.text());
  } else {
    throw new Error('Unsupported file type. Upload a PDF, Word (.docx), Markdown or text file.');
  }

  const chunks = blocksToChunks(blocks, title);
  if (chunks.length === 0) throw new Error('No readable text found in that file.');
  return { title, chunks };
}
