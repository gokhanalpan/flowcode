/**
 * C#: every example is generated, wrapped unchanged in its own namespace, and all of them are
 * compiled together in ONE `dotnet build` (one build is ~5 s; ten would be ~50 s). A tiny
 * dispatcher picks a program by name via reflection, so the generated code is not modified.
 * Then each program runs against the golden output like the other languages.
 *
 * Skipped when the `dotnet` SDK is not installed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile, generate, type Program } from '../src';

const examplesDir = fileURLToPath(new URL('../examples', import.meta.url));
const names = readdirSync(examplesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const readOptional = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const normalizeNewlines = (text: string): string => text.replace(/\r\n/g, '\n');

const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
const sdk = spawnSync('dotnet', ['--version'], { encoding: 'utf8', env });
const dotnetMajor = sdk.status === 0 ? parseInt(sdk.stdout.trim().split('.')[0], 10) : NaN;
const hasDotnet = Number.isInteger(dotnetMajor);

const ns = (name: string): string => `Ex_${name.replace(/[^A-Za-z0-9]/g, '_')}`;
const project = mkdtempSync(join(tmpdir(), 'flowcode-cs-'));
const dll = join(project, 'bin', 'Release', `net${dotnetMajor}.0`, 'FlowCodeExamples.dll');

const cases = names.map((name) => {
  const program = JSON.parse(readFileSync(join(examplesDir, `${name}.json`), 'utf8')) as Program;
  const result = compile(program);
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.diagnostics)}`);
  const code = generate(result.program, 'csharp');
  writeFileSync(join(project, `${name}.cs`), `namespace ${ns(name)}\n{\n${code}}\n`);
  return { name, input: readOptional(join(examplesDir, `${name}.in`)), expected: readOptional(join(examplesDir, `${name}.out`)) };
});

writeFileSync(join(project, 'FlowCodeExamples.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net${dotnetMajor}.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <StartupObject>Dispatcher</StartupObject>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <UseAppHost>false</UseAppHost>
  </PropertyGroup>
</Project>
`);

// A console app with no packages needs nothing from nuget.org; clearing the sources keeps the build offline.
writeFileSync(join(project, 'nuget.config'), `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
  </packageSources>
</configuration>
`);

writeFileSync(join(project, 'Dispatcher.cs'), `using System;
using System.Reflection;

static class Dispatcher
{
    static void Main(string[] args)
    {
        Type program = Type.GetType(args[0] + ".Program") ?? throw new Exception("unknown example " + args[0]);
        MethodInfo main = program.GetMethod("Main", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Static)!;
        main.Invoke(null, null);
    }
}
`);

describe.skipIf(!hasDotnet)('C# generator', () => {
  it('every generated program compiles with warnings as errors', () => {
    const build = spawnSync('dotnet', ['build', '-c', 'Release', '-nologo', '-v', 'q'], { cwd: project, encoding: 'utf8', env });
    expect(build.stdout + build.stderr).not.toMatch(/error/);
    expect(build.status).toBe(0);
    expect(existsSync(dll)).toBe(true);
  }, 180_000);

  it.each(cases)('$name runs on .NET with identical output', ({ name, input, expected }) => {
    const proc = spawnSync('dotnet', [dll, ns(name)], { input, encoding: 'utf8', env });
    expect(proc.stderr).toBe('');
    expect(proc.status).toBe(0);
    expect(normalizeNewlines(proc.stdout)).toBe(expected);
  }, 30_000);
});
