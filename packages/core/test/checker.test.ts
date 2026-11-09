import { describe, expect, it } from 'vitest';
import { compile, type Block, type Program } from '../src';

const program = (main: Block[], functions: Program['functions'] = []): Program => ({ version: 1, main, functions });
const codes = (p: Program): string[] => compile(p).diagnostics.map((d) => `${d.blockId ?? d.fn ?? '-'}:${d.code}`);

describe('type checker', () => {
  it('rejects undeclared variables', () => {
    expect(codes(program([{ id: 'a', kind: 'assign', target: 'x', value: '1' }]))).toEqual(['a:E_UNDECLARED']);
  });

  it('rejects real → int assignment but allows int → real', () => {
    expect(codes(program([
      { id: 'd1', kind: 'declare', name: 'i', type: 'int' },
      { id: 'd2', kind: 'declare', name: 'r', type: 'real' },
      { id: 'a1', kind: 'assign', target: 'i', value: '2.5' },
      { id: 'a2', kind: 'assign', target: 'r', value: '2' },
      { id: 'a3', kind: 'assign', target: 'i', value: '7 / 2' },
      { id: 'a4', kind: 'assign', target: 'i', value: '7 div 2' },
    ]))).toEqual(['a1:E_TYPE_ASSIGN', 'a3:E_TYPE_ASSIGN']);
  });

  it('requires boolean conditions and reports nested errors too', () => {
    expect(codes(program([
      { id: 'd', kind: 'declare', name: 'n', type: 'int' },
      { id: 'w', kind: 'while', condition: 'n', body: [{ id: 'inner', kind: 'assign', target: 'n', value: '"x"' }] },
    ]))).toEqual(['inner:E_TYPE_ASSIGN', 'w:E_TYPE_CONDITION']);
  });

  it('scopes declarations to the block they are in', () => {
    expect(codes(program([
      { id: 'd', kind: 'declare', name: 'f', type: 'bool' },
      { id: 'i', kind: 'if', condition: 'f', then: [{ id: 'd2', kind: 'declare', name: 'x', type: 'int' }], else: [] },
      { id: 'a', kind: 'assign', target: 'x', value: '1' },
    ]))).toEqual(['a:E_UNDECLARED']);
  });

  it('rejects break outside loops, redeclaration and reserved names', () => {
    expect(codes(program([
      { id: 'b', kind: 'break' },
      { id: 'd1', kind: 'declare', name: 'x', type: 'int' },
      { id: 'd2', kind: 'declare', name: 'x', type: 'string' },
      { id: 'd3', kind: 'declare', name: 'class', type: 'int' },
      { id: 'd4', kind: 'declare', name: 've', type: 'int' },
    ]))).toEqual(['b:E_BREAK_OUTSIDE_LOOP', 'd2:E_REDECLARED', 'd3:E_BAD_NAME', 'd4:E_BAD_NAME']);
  });

  it('checks function calls and returns', () => {
    expect(codes(program(
      [
        { id: 'c1', kind: 'call', name: 'twice', args: ['1'] },
        { id: 'c2', kind: 'call', name: 'twice', args: ['"s"'] },
        { id: 'c3', kind: 'call', name: 'nope', args: [] },
        { id: 'r', kind: 'return', value: '1' },
      ],
      [{ name: 'twice', params: [{ name: 'n', type: 'int' }], returns: 'int', body: [
        { id: 'f1', kind: 'return', value: '"no"' },
        { id: 'f2', kind: 'return', value: 'n * 2' },
      ] }],
    ))).toEqual(['c2:E_TYPE_ARG', 'c3:E_FN_UNKNOWN', 'r:E_RETURN_VALUE_MAIN', 'f1:E_TYPE_RETURN']);
  });

  it('indexes strings to one-character strings, read-only', () => {
    expect(codes(program([
      { id: 'd1', kind: 'declare', name: 's', type: 'string' },
      { id: 'd2', kind: 'declare', name: 'c', type: 'string' },
      { id: 'd3', kind: 'declare', name: 'n', type: 'int' },
      { id: 'a1', kind: 'assign', target: 'c', value: 's[0]' },
      { id: 'a2', kind: 'assign', target: 's', index: '0', value: '"x"' },
      { id: 'a3', kind: 'assign', target: 'n', index: '0', value: '1' },
      { id: 'a4', kind: 'assign', target: 'c', value: 's[1.5]' },
    ]))).toEqual(['a2:E_STRING_IMMUTABLE', 'a3:E_NOT_ARRAY', 'a4:E_TYPE_INDEX']);
  });

  it('types string concatenation and builtins', () => {
    expect(codes(program([
      { id: 'd1', kind: 'declare', name: 's', type: 'string' },
      { id: 'd2', kind: 'declare', name: 'n', type: 'int' },
      { id: 'a1', kind: 'assign', target: 's', value: '"n=" + n + true' },
      { id: 'a2', kind: 'assign', target: 'n', value: 'len(s) + round(2.5) + abs(-3)' },
      { id: 'a3', kind: 'assign', target: 'n', value: 'sqrt(16)' },
      { id: 'a4', kind: 'assign', target: 'n', value: 'len(5)' },
    ]))).toEqual(['a3:E_TYPE_ASSIGN', 'a4:E_TYPE_ARG']);
  });
});
