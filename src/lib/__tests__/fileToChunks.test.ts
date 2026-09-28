// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } from 'docx';
import { htmlToChunks, textToChunks } from '../fileToChunks';

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ') + '.';
const allText = (chunks: { section: string; text: string }[]) => chunks.map(c => `${c.section} ${c.text}`).join(' ');

describe('textToChunks', () => {
  it('splits Markdown on headings', () => {
    const chunks = textToChunks('# Weekly update\n\nThings went well.\n\n## Wins\n\nTwo new clients.\n\n## Risks\n\nHiring is behind.', 'Doc');
    expect(chunks.map(c => c.section)).toEqual(['Weekly update', 'Wins', 'Risks']);
    expect(chunks[1].text).toBe('Two new clients.');
  });

  it('uses the file title when text comes before any heading', () => {
    const chunks = textToChunks('Just a paragraph with no heading at all.', 'My notes');
    expect(chunks).toEqual([{ id: 'u1', section: 'My notes', text: 'Just a paragraph with no heading at all.' }]);
  });

  it('detects plain-text headings: short lines followed by a paragraph', () => {
    const chunks = textToChunks('Project Brief\nThis brief sets out the plan.\n\nScope\nTwo teams over six weeks.', 'Doc');
    expect(chunks.map(c => c.section)).toEqual(['Project Brief', 'Scope']);
  });

  it('does not treat list items or table rows as headings', () => {
    const chunks = textToChunks('Scope\nThe pilot covers:\n\n- Front office\n- Finance\n\n| a | b |\n| 1 | 2 |', 'Doc');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('- Front office');
    expect(chunks[0].text).toContain('| a | b |');
  });

  it('never drops text when short lines run together (e.g. flattened table cells)', () => {
    const input = 'Budget\n\nItem\n\nCost\n\nLicences\n\n£2,000\n\nNext steps\n\nAgree the start date by Friday.';
    const chunks = textToChunks(input, 'Doc');
    expect(chunks.map(c => c.section)).toEqual(['Doc', 'Next steps']);
    for (const piece of ['Budget', 'Item', 'Cost', 'Licences', '£2,000']) {
      expect(chunks[0].text).toContain(piece);
    }
    expect(chunks[1].text).toBe('Agree the start date by Friday.');
  });

  it('splits long sections into (cont.) parts of at most ~250 words, keeping every paragraph', () => {
    const paras = Array.from({ length: 6 }, (_, i) => `${words(100)} P${i}`);
    const chunks = textToChunks(`# Long section\n\n${paras.join('\n\n')}`, 'Doc');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].section).toBe('Long section');
    expect(chunks.slice(1).every(c => c.section === 'Long section (cont.)')).toBe(true);
    for (let i = 0; i < 6; i++) expect(allText(chunks)).toContain(`P${i}`);
    expect(chunks.every(c => c.text.split(/\s+/).length <= 260)).toBe(true);
  });

  it('keeps a single very long paragraph intact rather than cutting it mid-sentence', () => {
    const chunks = textToChunks(`# Big\n\n${words(600)}`, 'Doc');
    expect(chunks).toHaveLength(1);
  });

  it('folds a title into the next heading instead of dropping it', () => {
    const chunks = textToChunks('# AI Training Programme\n\n## Business Case\n\nPrepared by Shaun.', 'Doc');
    expect(chunks[0].section).toBe('AI Training Programme – Business Case');
  });

  it('returns no chunks for empty or whitespace-only input', () => {
    expect(textToChunks('', 'Doc')).toEqual([]);
    expect(textToChunks('   \n\n  \n', 'Doc')).toEqual([]);
  });

  it('handles Windows line endings', () => {
    const chunks = textToChunks('# One\r\n\r\nFirst.\r\n\r\n# Two\r\n\r\nSecond.', 'Doc');
    expect(chunks.map(c => c.section)).toEqual(['One', 'Two']);
  });

  it('gives every chunk a unique id', () => {
    const chunks = textToChunks('# A\n\nx.\n\n# B\n\ny.\n\n# C\n\nz.', 'Doc');
    expect(new Set(chunks.map(c => c.id)).size).toBe(chunks.length);
  });
});

describe('htmlToChunks', () => {
  it('uses h1-h4 as sections and converts lists and tables', () => {
    const html = '<h1>Brief</h1><p>Intro text here.</p><h2>Scope</h2><ul><li>Front office</li><li>Finance</li></ul>'
      + '<h2>Budget</h2><table><tr><td>Item</td><td>Cost</td></tr><tr><td>Licences</td><td>£2,000</td></tr></table>';
    const chunks = htmlToChunks(html, 'Doc');
    expect(chunks.map(c => c.section)).toEqual(['Brief', 'Scope', 'Budget']);
    expect(chunks[1].text).toBe('- Front office\n- Finance');
    expect(chunks[2].text).toContain('| Item | Cost |');
    expect(chunks[2].text).toContain('| Licences | £2,000 |');
  });

  it('treats bold-only paragraphs as headings when real text follows', () => {
    const chunks = htmlToChunks('<p><strong>Funding</strong></p><p>The route is still to confirm.</p>', 'Doc');
    expect(chunks).toEqual([{ id: 'u1', section: 'Funding', text: 'The route is still to confirm.' }]);
  });

  it('escapes pipes inside table cells so rows stay aligned', () => {
    const chunks = htmlToChunks('<h1>T</h1><table><tr><td>a | b</td><td>c</td></tr><tr><td>1</td><td>2</td></tr></table>', 'Doc');
    expect(chunks[0].text).toContain('| a / b | c |');
  });

  it('reads a real Word file with heading styles and a table', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ text: 'Executive Summary', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun('Relais has a clear opportunity.')] }),
      new Paragraph({ text: 'Funding', heading: HeadingLevel.HEADING_1 }),
      new Table({ rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Funding input')] }), new TableCell({ children: [new Paragraph('Current position')] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Existing balance')] }), new TableCell({ children: [new Paragraph('About £8k')] })] }),
      ] }),
    ] }] });
    const buffer = await Packer.toBuffer(doc);
    const { value } = await mammoth.convertToHtml({ buffer });
    const chunks = htmlToChunks(value, 'Doc');
    expect(chunks.map(c => c.section)).toEqual(['Executive Summary', 'Funding']);
    expect(chunks[1].text).toContain('| Existing balance | About £8k |');
  });
});
