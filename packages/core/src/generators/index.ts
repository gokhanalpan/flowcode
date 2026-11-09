import type { CompiledProgram } from '../bytecode';
import { generateJs, type JsOptions } from './js';
import { generatePython, type PythonOptions } from './python';
import { generateTypeScript, type TypeScriptOptions } from './typescript';
import { generateCSharp, type CSharpOptions } from './csharp';

export type LanguageId = 'js' | 'typescript' | 'python' | 'csharp' | 'cpp';

export interface LanguageInfo {
  id: LanguageId;
  name: string;
  extension: string;
  /** Free in the app; everything else is a paid unlock. The gate itself lives in the UI. */
  free: boolean;
  implemented: boolean;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { id: 'js', name: 'JavaScript', extension: 'js', free: true, implemented: true },
  { id: 'python', name: 'Python', extension: 'py', free: false, implemented: true },
  { id: 'typescript', name: 'TypeScript', extension: 'ts', free: false, implemented: true },
  { id: 'csharp', name: 'C#', extension: 'cs', free: false, implemented: true },
  { id: 'cpp', name: 'C++', extension: 'cpp', free: false, implemented: false },
];

export interface GenerateOptions extends JsOptions, PythonOptions, CSharpOptions {}

export function generate(compiled: CompiledProgram, language: LanguageId, options: GenerateOptions = {}): string {
  switch (language) {
    case 'js':
      return generateJs(compiled, options);
    case 'python':
      return generatePython(compiled, options);
    case 'typescript':
      return generateTypeScript(compiled, options);
    case 'csharp':
      return generateCSharp(compiled, options);
    default:
      throw new Error(`Code generator for "${language}" is not implemented yet`);
  }
}

export { generateJs, generatePython, generateTypeScript, generateCSharp };
export type { JsOptions, PythonOptions, TypeScriptOptions, CSharpOptions };
