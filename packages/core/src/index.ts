import { compileToBytecode, type CompiledProgram } from './bytecode';
import { checkProgram } from './checker';
import type { Diagnostic } from './errors';
import type { Program } from './ir';

export type CompileResult =
  | { ok: true; program: CompiledProgram; diagnostics: Diagnostic[] }
  | { ok: false; program?: undefined; diagnostics: Diagnostic[] };

/** Parse, type-check and compile a chart. Diagnostics carry block ids and stable codes for i18n. */
export function compile(program: Program): CompileResult {
  const { program: typed, diagnostics } = checkProgram(program);
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true, program: compileToBytecode(typed), diagnostics: [] };
}

export * from './ir';
export * from './ast';
export * from './errors';
export * from './values';
export { parseExpression } from './parser';
export { tokenize, isReservedWord, IDENTIFIER_RE } from './lexer';
export { BUILTINS } from './builtins';
export { checkProgram, assignable, isValidName } from './checker';
export { compileToBytecode } from './bytecode';
export type { CompiledProgram, Instr, FunctionEntry } from './bytecode';
export { Runner, runProgram, parseInput } from './runner';
export type { RunStatus, PauseReason, PendingInput, VariableView } from './runner';
export { generate, generateJs, generatePython, generateTypeScript, generateCSharp, LANGUAGES } from './generators';
export type { LanguageId, LanguageInfo, GenerateOptions, JsOptions, PythonOptions, TypeScriptOptions, CSharpOptions } from './generators';
export { layoutBlocks, edgeHandle } from './layout';
export type { Layout, LayoutNode, LayoutEdge, LayoutOptions, Insertion, Slot, NodeShape, Point } from './layout';
export { findBlock, insertBlock, updateBlock, deleteBlock, newBlockId, defaultBlock } from './edit';
export { variablesInScope } from './scope';
export type { VariableInScope } from './scope';
