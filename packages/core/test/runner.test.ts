import { describe, expect, it } from 'vitest';
import { compile, Runner, type Program } from '../src';

const chart: Program = {
  version: 1,
  main: [
    { id: 'd', kind: 'declare', name: 'n', type: 'int' },
    { id: 'in', kind: 'input', target: 'n' },
    { id: 'loop', kind: 'while', condition: 'n > 0', body: [
      { id: 'out', kind: 'output', value: 'n' },
      { id: 'dec', kind: 'assign', target: 'n', value: 'n - 1' },
    ] },
    { id: 'done', kind: 'output', value: '"done"' },
  ],
  functions: [],
};

const compiled = () => {
  const r = compile(chart);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.program;
};

describe('runner', () => {
  it('pauses for input, exposes variables, resumes', () => {
    const r = new Runner(compiled());
    expect(r.run()).toBe('waitingInput');
    // The Input block stays current while waiting, not the block after it.
    expect(r.currentBlockId).toBe('in');
    expect(r.pendingInput).toEqual({ name: 'n', index: undefined, type: 'int' });
    r.provideInput('2');
    expect(r.variables()).toEqual([{ name: 'n', type: { kind: 'scalar', base: 'int' }, value: 2 }]);
    expect(r.run()).toBe('finished');
    expect(r.output).toEqual(['2', '1', 'done']);
  });

  it('rejects bad input with a runtime error on the input block', () => {
    const r = new Runner(compiled());
    r.run();
    r.provideInput('abc');
    expect(r.status).toBe('error');
    expect(r.error).toMatchObject({ code: 'E_INPUT_INVALID', blockId: 'in' });
  });

  it('stops at breakpoints every time the block is entered', () => {
    const r = new Runner(compiled());
    r.breakpoints.add('out');
    r.run();
    r.provideInput('3');
    const hits: number[] = [];
    while (r.run() === 'paused') {
      expect(r.pauseReason).toBe('breakpoint');
      expect(r.currentBlockId).toBe('out');
      hits.push(r.variables()[0].value as number);
    }
    expect(hits).toEqual([3, 2, 1]);
    expect(r.status).toBe('finished');
  });

  it('steps one block at a time', () => {
    const r = new Runner(compiled());
    r.run();
    r.provideInput('1');
    const visited: string[] = [];
    while (r.step() === 'paused') visited.push(r.currentBlockId!);
    expect(visited).toEqual(['out', 'dec', 'loop', 'done']);
    expect(r.outputText).toBe('1\ndone\n');
  });

  it('enforces a step budget so infinite loops cannot hang the app', () => {
    const r = new Runner(compiled());
    r.run();
    r.provideInput('1000000000');
    expect(r.run(10_000)).toBe('paused');
    expect(r.pauseReason).toBe('budget');
    expect(r.run(10_000)).toBe('paused');
  });

  it('reports division by zero and stack overflow with block ids', () => {
    const div = compile({ version: 1, main: [
      { id: 'd', kind: 'declare', name: 'x', type: 'int' },
      { id: 'z', kind: 'assign', target: 'x', value: '1 div x' },
    ], functions: [] });
    const r = new Runner(div.program!);
    expect(r.run()).toBe('error');
    expect(r.error).toMatchObject({ code: 'E_DIV_ZERO', blockId: 'z' });

    const rec = compile({ version: 1, main: [{ id: 'c', kind: 'call', name: 'f', args: [] }], functions: [
      { name: 'f', params: [], body: [{ id: 'f1', kind: 'call', name: 'f', args: [] }] },
    ] });
    const r2 = new Runner(rec.program!);
    expect(r2.run()).toBe('error');
    expect(r2.error?.code).toBe('E_STACK_OVERFLOW');
    expect(r2.callStack.length).toBe(5000);
  });
});
