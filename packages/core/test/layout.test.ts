import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultBlock, deleteBlock, findBlock, insertBlock, layoutBlocks, newBlockId, type Block, type LayoutNode, type Program } from '../src';

const examplesDir = fileURLToPath(new URL('../examples', import.meta.url));
const names = readdirSync(examplesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const labelOf = (b: Block): string => JSON.stringify(b).slice(0, 30);

const countBlocks = (blocks: Block[]): number =>
  blocks.reduce((n, b) => {
    switch (b.kind) {
      case 'if': return n + 1 + countBlocks(b.then) + countBlocks(b.else);
      case 'while': case 'doWhile': case 'for': return n + 1 + countBlocks(b.body);
      default: return n + 1;
    }
  }, 0);

const overlap = (a: LayoutNode, b: LayoutNode): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe.each(names)('layout of %s', (name) => {
  const program = JSON.parse(readFileSync(join(examplesDir, `${name}.json`), 'utf8')) as Program;

  it('gives every block a node, inside the canvas, with no overlaps', () => {
    for (const body of [program.main, ...program.functions.map((f) => f.body)]) {
      const layout = layoutBlocks(body, { labelOf });
      expect(layout.nodes.length).toBe(countBlocks(body) + 2);
      for (const n of layout.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.width).toBeLessThanOrEqual(layout.width);
        expect(n.y + n.height).toBeLessThanOrEqual(layout.height);
      }
      for (let i = 0; i < layout.nodes.length; i++) {
        for (let j = i + 1; j < layout.nodes.length; j++) {
          expect(overlap(layout.nodes[i], layout.nodes[j]), `${layout.nodes[i].id} overlaps ${layout.nodes[j].id}`).toBe(false);
        }
      }
      for (const e of layout.edges) {
        for (const p of e.points) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('offers an insertion point for every position in every block list', () => {
    const layout = layoutBlocks(program.main, { labelOf });
    const keys = new Set(layout.edges.filter((e) => e.insertion).map((e) => `${e.insertion!.parentId}/${e.insertion!.slot}/${e.insertion!.index}`));
    const expectList = (list: Block[], parentId: string | null, slot: string): void => {
      for (let i = 0; i <= list.length; i++) expect(keys.has(`${parentId}/${slot}/${i}`), `${parentId}/${slot}/${i}`).toBe(true);
      for (const b of list) {
        if (b.kind === 'if') { expectList(b.then, b.id, 'then'); expectList(b.else, b.id, 'else'); }
        if (b.kind === 'while' || b.kind === 'doWhile' || b.kind === 'for') expectList(b.body, b.id, 'body');
      }
    };
    expectList(program.main, null, 'main');
  });
});

describe('edit helpers', () => {
  const program: Program = { version: 1, main: [
    { id: 'b1', kind: 'declare', name: 'x', type: 'int' },
    { id: 'b2', kind: 'if', condition: 'x > 0', then: [{ id: 'b3', kind: 'output', value: 'x' }], else: [] },
  ], functions: [] };

  it('inserts at nested insertion points without mutating', () => {
    const next = insertBlock(program.main, { parentId: 'b2', slot: 'else', index: 0 }, defaultBlock('break', 'b4'));
    expect(program.main[1]).toMatchObject({ else: [] });
    expect(next[1]).toMatchObject({ else: [{ id: 'b4', kind: 'break' }] });
    const top = insertBlock(program.main, { parentId: null, slot: 'main', index: 2 }, defaultBlock('return', 'b5'));
    expect(top.map((b) => b.id)).toEqual(['b1', 'b2', 'b5']);
  });

  it('finds, deletes and numbers blocks', () => {
    expect(findBlock(program.main, 'b3')).toMatchObject({ kind: 'output' });
    expect(deleteBlock(program.main, 'b3')[1]).toMatchObject({ then: [] });
    expect(newBlockId(program)).toBe('b4');
  });
});
