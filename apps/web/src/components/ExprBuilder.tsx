import type { VariableInScope } from '@flowcode/core';
import { parseExpression, tokenize } from '@flowcode/core';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  variables: VariableInScope[];
  optional?: boolean;
  /** Just variables and digits — for fields that only ever hold a number or a name, like an array size. */
  compact?: boolean;
}

/** Canonical token → what the display shows. Words come from i18n. */
const PRETTY: Record<string, string> = { '*': '×', '/': '÷', '!=': '≠', '<=': '≤', '>=': '≥', '==': '=', '%': 'mod' };

/**
 * Builds the expression as a list of tokens the user taps, and hands the joined text to the
 * block. The engine never sees anything new: the output is the same expression language the
 * keyboard produces. Keyboard mode shows the raw text for anyone who prefers it, and is the
 * fallback when the text can't be tokenized (half-typed from the keyboard).
 */
export function ExprBuilder({ label, value, onChange, variables, optional, compact }: Props) {
  const { t, lang, diagnostic } = useI18n();
  const id = useId();
  const [keyboard, setKeyboard] = useState(false);
  const [tokens, setTokens] = useState<string[]>(() => toTokens(value) ?? []);
  const emitted = useRef(value);

  // Re-derive tokens only when the value changed somewhere else (keyboard mode, another block).
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const parsed = toTokens(value);
    if (parsed) setTokens(parsed);
    else setKeyboard(true);
  }, [value]);

  const commit = (next: string[]) => {
    setTokens(next);
    const text = join(next);
    emitted.current = text;
    onChange(text);
  };

  const add = (tok: string) => {
    const next = [...tokens];
    const last = next[next.length - 1];
    if (/^\d$/.test(tok) || tok === '.') {
      if (last !== undefined && /^\d+(\.\d*)?$/.test(last) && !(tok === '.' && last.includes('.'))) {
        next[next.length - 1] = last + tok;
        return commit(next);
      }
      if (tok === '.') tok = '0.';
    }
    next.push(tok);
    commit(next);
  };

  const backspace = () => {
    const next = [...tokens];
    const last = next[next.length - 1];
    if (last !== undefined && /^\d+(\.\d*)?$/.test(last) && last.length > 1) next[next.length - 1] = last.slice(0, -1);
    else next.pop();
    commit(next);
  };

  const addText = () => {
    const text = window.prompt(t('expr.textPrompt'), '');
    if (text !== null) add(JSON.stringify(text));
  };

  let error: string | null = null;
  if (!(optional && value.trim() === '')) {
    try {
      parseExpression(value);
    } catch (e) {
      const err = e as { code: string; message: string };
      error = diagnostic(err.code, err.message);
    }
  }

  const word = (tok: string): string => (lang === 'tr' ? { and: 've', or: 'veya', not: 'değil', true: 'evet', false: 'hayır' }[tok] : tok) ?? tok;
  const pretty = tokens.map((tok) => PRETTY[tok] ?? word(tok));

  return (
    <div className={`field builder ${error ? 'has-error' : ''}`}>
      <div className="builder-head">
        <span>{label}</span>
        <button type="button" className="text-button small" onClick={() => setKeyboard((k) => !k)}>
          {keyboard ? t('expr.chips') : t('expr.keyboard')}
        </button>
      </div>

      {keyboard ? (
        <input id={id} className="mono" value={value} onChange={(e) => onChange(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus />
      ) : (
        <>
          <div className="expr-display mono" aria-live="polite">
            {pretty.length ? pretty.map((p, i) => <span key={i} className="tok">{p}</span>) : <span className="dim">{optional ? t('edit.optional') : '…'}</span>}
          </div>

          {variables.length > 0 && (
            <div className="chips-row">
              {variables.map((v) => (
                <button type="button" key={v.name} className="chip var" onClick={() => add(v.name)}>{v.name}</button>
              ))}
            </div>
          )}

          <div className={`keypad ${compact ? 'compact' : ''}`}>
            <div className="keys numbers">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '⌫'].map((k) => (
                <button type="button" key={k} className={k === '⌫' ? 'key soft' : 'key'} onClick={() => (k === '⌫' ? backspace() : add(k))}>{k}</button>
              ))}
            </div>
            {!compact && <>
            <div className="keys ops">
              {[['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷'], ['%', 'mod'], ['(', '('], [')', ')'], ['[', '['], [']', ']'], [',', ',']].map(([tok, show]) => (
                <button type="button" key={tok} className="key op" onClick={() => add(tok)}>{show}</button>
              ))}
            </div>
            <div className="keys compare">
              {[['==', '='], ['!=', '≠'], ['<', '<'], ['<=', '≤'], ['>', '>'], ['>=', '≥']].map(([tok, show]) => (
                <button type="button" key={tok} className="key op" onClick={() => add(tok)}>{show}</button>
              ))}
            </div>
            <div className="keys words">
              {['and', 'or', 'not', 'true', 'false'].map((tok) => (
                <button type="button" key={tok} className="key word" onClick={() => add(tok)}>{word(tok)}</button>
              ))}
              <button type="button" className="key word" onClick={addText}>{t('expr.text')}</button>
              <button type="button" className="key word" onClick={() => { add('len'); add('('); }}>{t('expr.length')}(</button>
              <button type="button" className="key soft" onClick={() => commit([])}>{t('expr.clear')}</button>
            </div>
            </>}
          </div>
        </>
      )}

      {error && <em>{error}</em>}
    </div>
  );
}

function toTokens(text: string): string[] | null {
  if (text.trim() === '') return [];
  try {
    return tokenize(text).filter((tk) => tk.kind !== 'eof').map((tk) => tk.text);
  } catch {
    return null;
  }
}

const isWord = (tok: string): boolean => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(tok) && !['and', 'or', 'not', 'div', 'true', 'false'].includes(tok);

/** Joins tokens back into text the way a person would space it: `len(x) + 1`, `arr[i]`, `f(a, b)`. */
function join(tokens: string[]): string {
  let out = '';
  tokens.forEach((tok, i) => {
    const prev = tokens[i - 1];
    const tight =
      i === 0 || tok === ')' || tok === ']' || tok === ',' || prev === '(' || prev === '[' || ((tok === '(' || tok === '[') && prev !== undefined && isWord(prev));
    out += (tight ? '' : ' ') + tok;
  });
  return out;
}
