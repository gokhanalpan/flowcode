import { describe, expect, it } from 'vitest';
import { variablesInScope, type Block } from '../src';

const names = (vs: { name: string }[]): string[] => vs.map((v) => v.name);

describe('variablesInScope', () => {
  const blocks: Block[] = [
    { id: 'd1', kind: 'declare', name: 'a', type: 'int' },
    { id: 'i1', kind: 'if', condition: 'a > 0', then: [
      { id: 'd2', kind: 'declare', name: 'inner', type: 'string' },
      { id: 'o1', kind: 'output', value: 'inner' },
    ], else: [] },
    { id: 'd3', kind: 'declare', name: 'arr', type: 'real', size: '3' },
    { id: 'o2', kind: 'output', value: 'a' },
  ];

  it('sees earlier declarations in the same and enclosing lists, not later or sibling ones', () => {
    expect(names(variablesInScope(blocks, 'd1'))).toEqual([]);
    expect(names(variablesInScope(blocks, 'o1'))).toEqual(['a', 'inner']);
    expect(names(variablesInScope(blocks, 'd3'))).toEqual(['a']);
    expect(names(variablesInScope(blocks, 'o2'))).toEqual(['a', 'arr']);
    expect(names(variablesInScope(blocks, undefined))).toEqual(['a', 'arr']);
  });

  it('includes parameters with their types', () => {
    const vs = variablesInScope(blocks, 'd1', [{ name: 'p', type: 'int' }, { name: 'xs', type: 'bool', array: true }]);
    expect(vs).toEqual([{ name: 'p', type: { kind: 'scalar', base: 'int' } }, { name: 'xs', type: { kind: 'array', base: 'bool' } }]);
    expect(variablesInScope(blocks, 'o2').find((v) => v.name === 'arr')?.type).toEqual({ kind: 'array', base: 'real' });
  });
});
