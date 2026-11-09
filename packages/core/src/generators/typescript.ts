import type { CompiledProgram } from '../bytecode';
import { generateJsLike, type JsOptions } from './js';

export type TypeScriptOptions = JsOptions;

/**
 * TypeScript = the JavaScript generator plus type annotations:
 * `int`/`real` → number, `string` → string, `bool` → boolean, arrays → T[].
 * The Node runtime imports `node:fs` instead of using require().
 */
export function generateTypeScript(compiled: CompiledProgram, options: TypeScriptOptions = {}): string {
  return generateJsLike(compiled, options, { typescript: true });
}
