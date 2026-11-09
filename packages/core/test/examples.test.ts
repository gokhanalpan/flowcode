/**
 * The test that matters: every example chart is run through the interpreter AND through
 * the real toolchain of every implemented generator (Node for JS, python3 for Python),
 * with the same input, and all outputs must match the golden .out file. Add a .json
 * (+ .in/.out) to examples/ and it is picked up automatically.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile, generate, runProgram, type Program } from '../src';

const examplesDir = fileURLToPath(new URL('../examples', import.meta.url));
const names = readdirSync(examplesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const tmp = mkdtempSync(join(tmpdir(), 'flowcode-'));

const readOptional = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

// Windows installs usually expose `python`, not `python3`.
const pythonCommand = ['python3', 'python'].find((cmd) => spawnSync(cmd, ['--version']).status === 0);
const pythonEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

// Toolchains on Windows write \r\n (Python's text-mode stdout, C#'s Console.WriteLine, C++ streams).
// The contract is about content; the line ending belongs to the platform, so compare normalized.
const normalizeNewlines = (text: string): string => text.replace(/\r\n/g, '\n');

describe.each(names)('example %s', (name) => {
  const program = JSON.parse(readFileSync(join(examplesDir, `${name}.json`), 'utf8')) as Program;
  const input = readOptional(join(examplesDir, `${name}.in`));
  const expected = readOptional(join(examplesDir, `${name}.out`));
  const inputLines = input === '' ? [] : input.replace(/\n$/, '').split('\n');

  const result = compile(program);

  it('compiles without diagnostics', () => {
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('interpreter output matches the golden file', () => {
    if (!result.ok) return;
    const run = runProgram(result.program, inputLines);
    expect(run.error).toBeNull();
    expect(run.status).toBe('finished');
    expect(run.output).toBe(expected);
  });

  it('generated JavaScript runs in Node with identical output', () => {
    if (!result.ok) return;
    const js = generate(result.program, 'js', { runtime: 'node' });
    const file = join(tmp, `${name}.cjs`);
    writeFileSync(file, js);
    const proc = spawnSync(process.execPath, [file], { input, encoding: 'utf8' });
    expect(proc.stderr).toBe('');
    expect(proc.status).toBe(0);
    expect(normalizeNewlines(proc.stdout)).toBe(expected);
    expect(normalizeNewlines(proc.stdout)).toBe(runProgram(result.program, inputLines).output);
  });

  it.skipIf(!pythonCommand)('generated Python runs in python3 with identical output', () => {
    if (!result.ok) return;
    const py = generate(result.program, 'python');
    const file = join(tmp, `${name}.py`);
    writeFileSync(file, py);
    const proc = spawnSync(pythonCommand!, [file], { input, encoding: 'utf8', env: pythonEnv });
    expect(proc.stderr).toBe('');
    expect(proc.status).toBe(0);
    expect(normalizeNewlines(proc.stdout)).toBe(expected);
  });
});
