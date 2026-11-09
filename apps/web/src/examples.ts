import type { Program } from '@flowcode/core';

const modules = import.meta.glob('../../../packages/core/examples/*.json', { eager: true, import: 'default' }) as Record<string, Program>;

export const examples: Array<{ id: string; program: Program }> = Object.entries(modules)
  .map(([path, program]) => ({ id: path.split('/').pop()!.replace(/\.json$/, ''), program }))
  .filter((e) => e.id !== 'semantics')
  .sort((a, b) => a.id.localeCompare(b.id));
