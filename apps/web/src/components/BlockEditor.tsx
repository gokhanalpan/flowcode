import type { BaseType, Block, Diagnostic, Insertion, VariableInScope } from '@flowcode/core';
import { typeToString } from '@flowcode/core';
import { useId, useState } from 'react';
import { ExprBuilder } from './ExprBuilder';
import { useI18n, type StringKey } from '../i18n';

const TYPES: BaseType[] = ['int', 'real', 'string', 'bool'];
const KINDS: Block['kind'][] = ['declare', 'assign', 'input', 'output', 'if', 'while', 'doWhile', 'for', 'call', 'comment', 'break', 'return'];

interface EditorProps {
  block: Block;
  diagnostics: Diagnostic[];
  /** Variables visible at this block, in declaration order. */
  variables: VariableInScope[];
  functionNames: string[];
  breakpoint: boolean;
  onChange: (block: Block) => void;
  onToggleBreakpoint: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function BlockEditor({ block, diagnostics, variables, functionNames, breakpoint, onChange, onToggleBreakpoint, onDelete, onClose }: EditorProps) {
  const { t, diagnostic } = useI18n();
  const set = <K extends string>(key: K, value: unknown) => onChange({ ...block, [key]: value } as Block);
  const isArray = (name: string): boolean => variables.find((v) => v.name === name)?.type.kind === 'array';

  return (
    <div className="sheet" role="dialog" aria-label={t(`kind.${block.kind}` as StringKey)}>
      <div className="sheet-head">
        <strong>{t(`kind.${block.kind}` as StringKey)}</strong>
        <button type="button" className="text-button" onClick={onClose}>{t('edit.done')}</button>
      </div>

      <div className="fields">
        {block.kind === 'declare' && (
          <>
            <Field label={t('edit.name')} value={block.name} onChange={(v) => set('name', v)} mono />
            <label className="field">
              <span>{t('edit.type')}</span>
              <select value={block.type} onChange={(e) => set('type', e.target.value as BaseType)}>
                {TYPES.map((ty) => <option key={ty} value={ty}>{t(`type.${ty}`)}</option>)}
              </select>
            </label>
            <ExprBuilder variables={variables} label={`${t('edit.array')} (${t('edit.optional')})`} value={block.size ?? ''} onChange={(v) => set('size', v === '' ? undefined : v)} optional compact />
          </>
        )}
        {(block.kind === 'assign' || block.kind === 'input') && (
          <>
            <VariablePicker label={t('edit.target')} value={block.target} variables={variables} onChange={(v) => onChange({ ...block, target: v, index: isArray(v) ? block.index : undefined })} />
            {isArray(block.target) && (
              <ExprBuilder variables={variables} label={t('edit.index')} value={block.index ?? ''} onChange={(v) => set('index', v === '' ? undefined : v)} optional />
            )}
            {block.kind === 'assign' && <ExprBuilder variables={variables} label={t('edit.value')} value={block.value} onChange={(v) => set('value', v)} />}
          </>
        )}
        {block.kind === 'output' && (
          <>
            <ExprBuilder variables={variables} label={t('edit.value')} value={block.value} onChange={(v) => set('value', v)} />
            <label className="check">
              <input type="checkbox" checked={block.newline !== false} onChange={(e) => set('newline', e.target.checked ? undefined : false)} />
              <span>{t('edit.newline')}</span>
            </label>
          </>
        )}
        {(block.kind === 'if' || block.kind === 'while' || block.kind === 'doWhile') && (
          <ExprBuilder variables={variables} label={t('edit.condition')} value={block.condition} onChange={(v) => set('condition', v)} />
        )}
        {block.kind === 'for' && (
          <>
            <VariablePicker label={t('edit.variable')} value={block.variable} variables={variables.filter((v) => v.type.kind === 'scalar' && v.type.base === 'int')} onChange={(v) => set('variable', v)} />
            <ExprBuilder variables={variables} label={t('edit.from')} value={block.from} onChange={(v) => set('from', v)} />
            <ExprBuilder variables={variables} label={t('edit.to')} value={block.to} onChange={(v) => set('to', v)} />
            <Field label={t('edit.step')} value={String(block.step ?? 1)} onChange={(v) => set('step', Number.isInteger(Number(v)) && v !== '' ? Number(v) : v)} mono />
          </>
        )}
        {block.kind === 'call' && (
          <>
            <label className="field">
              <span>{t('edit.function')}</span>
              <select value={block.name} onChange={(e) => set('name', e.target.value)}>
                <option value="">—</option>
                {functionNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <Field label={t('edit.args')} value={block.args.join(', ')} onChange={(v) => set('args', v.trim() === '' ? [] : v.split(',').map((a) => a.trim()))} mono />
          </>
        )}
        {block.kind === 'comment' && <Field label={t('edit.text')} value={block.text} onChange={(v) => set('text', v)} />}
        {block.kind === 'return' && (
          <ExprBuilder variables={variables} label={`${t('edit.value')} (${t('edit.optional')})`} value={block.value ?? ''} onChange={(v) => set('value', v === '' ? undefined : v)} optional />
        )}
      </div>

      {diagnostics.length > 0 && (
        <ul className="problems">
          {diagnostics.map((d, i) => <li key={i}>{diagnostic(d.code, d.message)}</li>)}
        </ul>
      )}

      <div className="sheet-foot">
        <label className="check">
          <input type="checkbox" checked={breakpoint} onChange={onToggleBreakpoint} />
          <span>{t('edit.breakpoint')}</span>
        </label>
        <button type="button" className="text-button danger" onClick={onDelete}>{t('edit.delete')}</button>
        <button type="button" className="primary" onClick={onClose}>{t('edit.done')}</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} className={mono ? 'mono' : undefined} value={value} onChange={(e) => onChange(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    </label>
  );
}

/**
 * A dropdown of the variables in scope. If the block refers to a name that isn't declared
 * (deleted, or typed before the Declare existed) it stays selectable, marked, so nothing is lost.
 */
function VariablePicker({ label, value, variables, onChange }: { label: string; value: string; variables: VariableInScope[]; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const id = useId();
  const known = variables.some((v) => v.name === value);
  return (
    <label className={`field ${value && !known ? 'has-error' : ''}`} htmlFor={id}>
      <span>{label}</span>
      <select id={id} className="mono" value={value} onChange={(e) => onChange(e.target.value)}>
        {variables.length === 0 && !value && <option value="">{t('edit.noVariables')}</option>}
        {value && !known && <option value={value}>{value} — ?</option>}
        {variables.map((v) => <option key={v.name} value={v.name}>{v.name}: {typeToString(v.type)}</option>)}
      </select>
      {variables.length === 0 && <em className="dim">{t('edit.noVariablesHint')}</em>}
    </label>
  );
}

/** The six blocks a beginner needs are visible; the rest are one tap away. */
const BASIC_KINDS: Block['kind'][] = ['declare', 'input', 'output', 'if', 'for', 'while'];

export function InsertMenu({ at, onPick, onClose }: { at: Insertion; onPick: (kind: Block['kind'], at: Insertion) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const kinds = more ? KINDS : BASIC_KINDS;
  return (
    <div className="sheet" role="dialog" aria-label={t('insert.title')}>
      <div className="sheet-head">
        <strong>{t('insert.title')}</strong>
        <button type="button" className="text-button" onClick={onClose}>✕</button>
      </div>
      <div className="kinds">
        {kinds.map((kind) => (
          <button type="button" key={kind} className={`kind kind-${kind}`} onClick={() => onPick(kind, at)}>
            {t(`kind.${kind}` as StringKey)}
          </button>
        ))}
      </div>
      {!more && <button type="button" className="text-button" onClick={() => setMore(true)}>{t('insert.more')}</button>}
    </div>
  );
}
