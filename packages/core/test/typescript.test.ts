/**
 * The TypeScript generator gets one extra check the others don't: every generated program,
 * in both runtimes, must pass `tsc --strict`. Then the Node variant is transpiled and run
 * against the golden output like the other languages.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compile, generate, type Program } from '../src';

const root = fileURLToPath(new URL('..', import.meta.url));
// Wherever the package manager put @types/node (hoisted to the workspace root or local).
const typesRoot = dirname(dirname(createRequire(import.meta.url).resolve('@types/node/package.json')));
const examplesDir = join(root, 'examples');
const names = readdirSync(examplesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const tmp = mkdtempSync(join(tmpdir(), 'flowcode-ts-'));
const readOptional = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

const cases = names.map((name) => {
  const program = JSON.parse(readFileSync(join(examplesDir, `${name}.json`), 'utf8')) as Program;
  const result = compile(program);
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.diagnostics)}`);
  const node = generate(result.program, 'typescript', { runtime: 'node' });
  const browser = generate(result.program, 'typescript', { runtime: 'browser' });
  const nodeFile = join(tmp, `${name}.node.ts`);
  const browserFile = join(tmp, `${name}.browser.ts`);
  writeFileSync(nodeFile, node);
  writeFileSync(browserFile, browser);
  return {
    name,
    node,
    nodeFile,
    browserFile,
    input: readOptional(join(examplesDir, `${name}.in`)),
    expected: readOptional(join(examplesDir, `${name}.out`)),
  };
});

describe('TypeScript generator', () => {
  it('every generated program passes tsc --strict (node and browser runtimes)', () => {
    const files = cases.flatMap((c) => [c.nodeFile, c.browserFile]);
    const program = ts.createProgram(files, {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: ['node'],
      typeRoots: [typesRoot],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
      const where = d.file ? `${d.file.fileName.split('/').pop()}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}` : '';
      return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
    expect(diagnostics).toEqual([]);
  });

  it.each(cases)('$name runs in Node with identical output', ({ name, node, input, expected }) => {
    const js = ts.transpileModule(node, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const file = join(tmp, `${name}.cjs`);
    writeFileSync(file, js);
    const proc = spawnSync(process.execPath, [file], { input, encoding: 'utf8' });
    expect(proc.stderr).toBe('');
    expect(proc.status).toBe(0);
    expect(proc.stdout.replace(/\r\n/g, '\n')).toBe(expected);
  });
});
