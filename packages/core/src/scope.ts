import type { Block, Param, VarType } from './ir';
import { arrayOf, scalar } from './ir';

export interface VariableInScope {
  name: string;
  type: VarType;
}

/**
 * The variables visible at a block: parameters of the function, plus every Declare that comes
 * before it in the same or an enclosing block list. Same lexical rules as the checker, so what
 * the editor offers in a dropdown is exactly what will compile.
 *
 * `blockId` undefined → variables visible at the end of the list (for a new block appended there).
 */
export function variablesInScope(blocks: Block[], blockId: string | undefined, params: Param[] = []): VariableInScope[] {
  const visible: VariableInScope[] = params.map((p) => ({ name: p.name, type: p.array ? arrayOf(p.type) : scalar(p.type) }));
  const found = walk(blocks, blockId, visible);
  return found ?? visible;
}

/** Returns the scope at the target block, or null if the block is not in this list. */
function walk(blocks: Block[], blockId: string | undefined, outer: VariableInScope[]): VariableInScope[] | null {
  const scope = [...outer];
  for (const b of blocks) {
    if (b.id === blockId) return scope;
    const nested: Block[][] = blockId === undefined ? [] : b.kind === 'if' ? [b.then, b.else] : b.kind === 'while' || b.kind === 'doWhile' || b.kind === 'for' ? [b.body] : [];
    for (const list of nested) {
      const inner = walk(list, blockId, scope);
      if (inner) return inner;
    }
    if (b.kind === 'declare') scope.push({ name: b.name, type: b.size !== undefined ? arrayOf(b.type) : scalar(b.type) });
  }
  return blockId === undefined ? scope : null;
}
