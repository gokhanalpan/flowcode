import type { Block, Program } from './ir';
import type { Insertion } from './layout';

/** Immutable editing helpers for a block list (a function body). */

export function findBlock(blocks: Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    for (const list of children(b)) {
      const found = findBlock(list, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function insertBlock(blocks: Block[], at: Insertion, block: Block): Block[] {
  if (at.parentId === null) return [...blocks.slice(0, at.index), block, ...blocks.slice(at.index)];
  return mapBlocks(blocks, (b) => {
    if (b.id !== at.parentId) return b;
    switch (at.slot) {
      case 'then': return b.kind === 'if' ? { ...b, then: splice(b.then, at.index, block) } : b;
      case 'else': return b.kind === 'if' ? { ...b, else: splice(b.else, at.index, block) } : b;
      case 'body': return b.kind === 'while' || b.kind === 'doWhile' || b.kind === 'for' ? { ...b, body: splice(b.body, at.index, block) } : b;
      default: return b;
    }
  });
}

export function updateBlock(blocks: Block[], id: string, update: (b: Block) => Block): Block[] {
  return mapBlocks(blocks, (b) => (b.id === id ? update(b) : b));
}

export function deleteBlock(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b) => {
      switch (b.kind) {
        case 'if': return { ...b, then: deleteBlock(b.then, id), else: deleteBlock(b.else, id) };
        case 'while': case 'doWhile': case 'for': return { ...b, body: deleteBlock(b.body, id) };
        default: return b;
      }
    });
}

/** Ids are `b<n>`; the next one is larger than every existing id in the program. */
export function newBlockId(program: Program): string {
  let max = 0;
  const visit = (blocks: Block[]): void => {
    for (const b of blocks) {
      const m = /^b(\d+)$/.exec(b.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
      for (const list of children(b)) visit(list);
    }
  };
  visit(program.main);
  for (const fn of program.functions) visit(fn.body);
  return `b${max + 1}`;
}

/** A sensible starting block of each kind; the editor opens it for editing right away. */
export function defaultBlock(kind: Block['kind'], id: string): Block {
  switch (kind) {
    case 'declare': return { id, kind, name: 'x', type: 'int' };
    case 'assign': return { id, kind, target: 'x', value: '0' };
    case 'input': return { id, kind, target: 'x' };
    case 'output': return { id, kind, value: '""' };
    case 'if': return { id, kind, condition: 'x > 0', then: [], else: [] };
    case 'while': return { id, kind, condition: 'x > 0', body: [] };
    case 'doWhile': return { id, kind, body: [], condition: 'x > 0' };
    case 'for': return { id, kind, variable: 'i', from: '1', to: '10', body: [] };
    case 'call': return { id, kind, name: '', args: [] };
    case 'comment': return { id, kind, text: '' };
    case 'break': return { id, kind };
    case 'return': return { id, kind };
  }
}

function children(b: Block): Block[][] {
  switch (b.kind) {
    case 'if': return [b.then, b.else];
    case 'while': case 'doWhile': case 'for': return [b.body];
    default: return [];
  }
}

function splice(list: Block[], index: number, block: Block): Block[] {
  return [...list.slice(0, index), block, ...list.slice(index)];
}

function mapBlocks(blocks: Block[], f: (b: Block) => Block): Block[] {
  return blocks.map((b) => {
    const mapped = f(b);
    switch (mapped.kind) {
      case 'if': return { ...mapped, then: mapBlocks(mapped.then, f), else: mapBlocks(mapped.else, f) };
      case 'while': case 'doWhile': case 'for': return { ...mapped, body: mapBlocks(mapped.body, f) };
      default: return mapped;
    }
  });
}
