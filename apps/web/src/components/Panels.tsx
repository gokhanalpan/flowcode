import type { CompileResult, Diagnostic, LanguageId, Runner, VariableView } from '@flowcode/core';
import { LANGUAGES, formatValue, generate, typeToString } from '@flowcode/core';
import { useEffect, useRef, useState } from 'react';
import { isUnlocked, unlock } from '../entitlements';
import { useI18n } from '../i18n';

export interface RunState {
  runner: Runner | null;
  /** Bumped after every runner operation so React re-renders from the mutable runner. */
  version: number;
}

export type Speed = 'slow' | 'normal' | 'fast';

interface RunProps {
  compiled: CompileResult;
  run: RunState;
  playing: boolean;
  speed: Speed;
  onSpeed: (s: Speed) => void;
  onPlay: () => void;
  onPause: () => void;
  onRun: () => void;
  onStep: () => void;
  onStop: () => void;
  onInput: (line: string) => void;
  onSelectBlock: (id: string) => void;
}

export function RunPanel({ compiled, run, playing, speed, onSpeed, onPlay, onPause, onRun, onStep, onStop, onInput, onSelectBlock }: RunProps) {
  const { t, diagnostic } = useI18n();
  const [line, setLine] = useState('');
  const consoleEl = useRef<HTMLDivElement>(null);
  const r = run.runner;
  const status = r?.status;

  useEffect(() => {
    consoleEl.current?.scrollTo({ top: consoleEl.current.scrollHeight });
  }, [run.version]);

  const submit = () => {
    onInput(line);
    setLine('');
  };

  const canStart = compiled.ok && (!r || status === 'finished' || status === 'error');
  const running = r && (status === 'paused' || status === 'waitingInput' || status === 'ready');

  return (
    <div className="panel">
      <div className="toolbar">
        {playing
          ? <button type="button" className="primary" onClick={onPause}>❚❚ {t('run.pause')}</button>
          : <button type="button" className="primary" onClick={onPlay} disabled={!compiled.ok || status === 'waitingInput'}>▶ {t('run.play')}</button>}
        <button type="button" onClick={onStep} disabled={!compiled.ok || playing || status === 'waitingInput'}>{t('run.step')}</button>
        {running && <button type="button" onClick={onStop}>■ {t('run.stop')}</button>}
        <label className="speed">
          <span>{t('run.speed')}</span>
          <select value={speed} onChange={(e) => onSpeed(e.target.value as Speed)}>
            <option value="slow">{t('speed.slow')}</option>
            <option value="normal">{t('speed.normal')}</option>
            <option value="fast">{t('speed.fast')}</option>
          </select>
        </label>
        <button type="button" className="text-button small" onClick={onRun} disabled={!compiled.ok}>{t('run.fast')}</button>
        <span className="status">
          {status === 'finished' && t('run.finished')}
          {status === 'paused' && !playing && (r!.pauseReason === 'budget' ? t('run.budget') : r!.pauseReason === 'breakpoint' ? t('run.paused') : '')}
          {status === 'error' && t('run.error')}
        </span>
      </div>

      {!compiled.ok && (
        <div className="problems-box">
          <strong>{t('run.fixFirst')}</strong>
          <ul className="problems">
            {compiled.diagnostics.map((d: Diagnostic, i: number) => (
              <li key={i}>
                {d.blockId ? <button type="button" className="link" onClick={() => onSelectBlock(d.blockId!)}>{t('diag.block')} {d.blockId}</button> : d.fn}
                {' '}{diagnostic(d.code, d.message)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!canStart || r ? (
        <>
          <div className="console" ref={consoleEl} aria-label={t('run.console')}>
            {r?.output.map((l, i) => <div key={i}>{l || '\u00a0'}</div>)}
            {r && (r.partialLine || status === 'waitingInput') && (
              <div className="partial">
                {r.partialLine}
                {status === 'waitingInput' && (
                  <input
                    className="inline-input mono"
                    autoFocus
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                    placeholder={t('run.inputPrompt', { name: r.pendingInput!.name, type: t(`type.${r.pendingInput!.type}`) })}
                  />
                )}
              </div>
            )}
            {status === 'error' && r?.error && <div className="error-line">{diagnostic(r.error.code, r.error.message)}</div>}
          </div>
          {status === 'waitingInput' && <button type="button" className="primary wide" onClick={submit}>{t('run.send')}</button>}
          {r && r.variables().length > 0 && <Variables rows={r.variables()} />}
        </>
      ) : (
        compiled.ok && <p className="hint">{t('run.empty')}</p>
      )}
    </div>
  );
}

function Variables({ rows }: { rows: VariableView[] }) {
  const { t } = useI18n();
  return (
    <table className="vars" aria-label={t('run.variables')}>
      <tbody>
        {rows.map((v) => (
          <tr key={v.name}>
            <td className="mono">{v.name}</td>
            <td className="dim">{typeToString(v.type)}</td>
            <td className="mono">{formatValue(v.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CodePanel({ compiled }: { compiled: CompileResult }) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<LanguageId>('js');
  const [copied, setCopied] = useState(false);
  const [, bump] = useState(0);
  const unlocked = isUnlocked(language);
  const info = LANGUAGES.find((l) => l.id === language)!;

  let code = '';
  if (compiled.ok && info.implemented) {
    try {
      code = generate(compiled.program, language);
    } catch (e) {
      code = String(e);
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="panel">
      <div className="chips" role="tablist">
        {LANGUAGES.filter((l) => l.implemented).map((l) => (
          <button type="button" role="tab" key={l.id} className={`chip ${l.id === language ? 'on' : ''}`} aria-selected={l.id === language} onClick={() => setLanguage(l.id)}>
            {l.name}{l.free && <small> · {t('code.free')}</small>}
          </button>
        ))}
      </div>
      {!compiled.ok ? (
        <p className="hint">{t('code.fixFirst')}</p>
      ) : (
        <div className={`code-wrap ${unlocked ? '' : 'locked'}`}>
          <pre className="code mono"><code>{unlocked ? code : <LockedPreview code={code} />}</code></pre>
          {unlocked ? (
            <button type="button" className="copy" onClick={copy}>{copied ? t('code.copied') : t('code.copy')}</button>
          ) : (
            <div className="lock">
              <button type="button" className="primary" onClick={async () => { await unlock(language); bump((n) => n + 1); }}>
                {t('code.locked', { lang: info.name })}
              </button>
              <small>{t('code.lockedHint')}</small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The first lines readable, the rest blurred: enough to see what the purchase buys. */
function LockedPreview({ code }: { code: string }) {
  const lines = code.split('\n');
  return (
    <>
      {lines.slice(0, 8).join('\n')}
      {'\n'}
      <span className="blur" aria-hidden="true">{lines.slice(8).join('\n')}</span>
    </>
  );
}
