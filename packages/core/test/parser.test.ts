import { describe, expect, it } from 'vitest';
import { parseExpression, type Expr } from '../src';

const strip = (e: Expr): unknown => {
  switch (e.kind) {
    case 'num': return e.isInt ? e.value : { real: e.value };
    case 'str': return { str: e.value };
    case 'bool': return e.value;
    case 'var': return e.name;
    case 'index': return { index: [e.name, strip(e.index)] };
    case 'unary': return { [e.op]: strip(e.operand) };
    case 'binary': return { [e.op]: [strip(e.left), strip(e.right)] };
    case 'call': return { call: [e.name, ...e.args.map(strip)] };
  }
};
const parse = (src: string): unknown => strip(parseExpression(src));

describe('expression parser', () => {
  it('respects arithmetic precedence', () => {
    expect(parse('1 + 2 * 3')).toEqual({ '+': [1, { '*': [2, 3] }] });
    expect(parse('(1 + 2) * 3')).toEqual({ '*': [{ '+': [1, 2] }, 3] });
    expect(parse('10 div 3 % 2')).toEqual({ '%': [{ div: [10, 3] }, 2] });
  });

  it('makes ^ right-associative and tighter than unary minus', () => {
    expect(parse('2 ^ 3 ^ 2')).toEqual({ '^': [2, { '^': [3, 2] }] });
    expect(parse('-2 ^ 2')).toEqual({ '-': { '^': [2, 2] } });
    expect(parse('2 ^ -1')).toEqual({ '^': [2, { '-': 1 }] });
  });

  it('parses logic with not binding looser than comparison', () => {
    expect(parse('not a == b or c')).toEqual({ or: [{ not: { '==': ['a', 'b'] } }, 'c'] });
    expect(parse('a && b || !c')).toEqual({ or: [{ and: ['a', 'b'] }, { not: 'c' }] });
  });

  it('accepts Turkish word aliases and = / <> comparison spellings', () => {
    expect(parse('x > 1 ve değil (y = 2)')).toEqual({ and: [{ '>': ['x', 1] }, { not: { '==': ['y', 2] } }] });
    expect(parse('a <> b veya doğru')).toEqual({ or: [{ '!=': ['a', 'b'] }, true] });
    expect(parse('n MOD 2')).toEqual({ '%': ['n', 2] });
  });

  it('parses calls, indexing, strings and reals', () => {
    expect(parse('max(len(s), arr[i + 1])')).toEqual({ call: ['max', { call: ['len', 's'] }, { index: ['arr', { '+': ['i', 1] }] }] });
    expect(parse('"a\\"b" + 2.5')).toEqual({ '+': [{ str: 'a"b' }, { real: 2.5 }] });
  });

  it('reports syntax errors with a position', () => {
    expect(() => parseExpression('1 +')).toThrow(/ends unexpectedly/);
    expect(() => parseExpression('(1 + 2')).toThrow(/Expected "\)"/);
    expect(() => parseExpression('1 2')).toThrow(/Unexpected "2"/);
    expect(() => parseExpression('"abc')).toThrow(/Unterminated/);
    expect(() => parseExpression('')).toThrow(/empty/);
    try { parseExpression('a + $'); } catch (e) { expect((e as { pos: number }).pos).toBe(4); }
  });
});
