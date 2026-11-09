import {
  compile,
  defaultBlock,
  deleteBlock,
  findBlock,
  insertBlock,
  layoutBlocks,
  newBlockId,
  Runner,
  updateBlock,
  variablesInScope,
  type Block,
  type Insertion,
  type Program,
} from '@flowcode/core';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../i18n';
import { blockLabel } from '../labels';
import { saveDraft, type SavedChart } from '../storage';
import type { TutorialStep } from '../tutorial';
import { BlockEditor, InsertMenu } from './BlockEditor';
import { ChartCanvas } from './ChartCanvas';
import { Coach } from './Coach';
import { CodePanel, RunPanel, type RunState, type Speed } from './Panels';

type Sheet = { kind: 'edit'; id: string } | { kind: 'insert'; at: Insertion } | null;

interface EditorProps {
  chart: SavedChart;
  /** Present → the coach bar shows these steps. */
  tutorial?: TutorialStep[];
  onSave: (chart: SavedChart) => void;
  onExit: () => void;
  onToggleLang: () => void;
}

export function Editor({ chart, tutorial, onSave, onExit, onToggleLang }: EditorProps) {
  const i18n = useI18n();
  const { t } = i18n;

  const [program, setProgram] = useState<Program>(chart.program);
  const [name, setName] = useState(chart.name);
  const [dirty, setDirty] = useState(false);
  const [fnName, setFnName] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheet, setSheetState] = useState<Sheet>(null);
  /** On a phone the sheet and the run panel can't share the screen; opening one closes the other. */
  const setSheet = (next: Sheet) => {
    setSheetState(next);
    if (next && window.innerWidth < 900) setPanelOpen(false);
  };
  const [tab, setTab] = useState<'run' | 'code'>('run');
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<RunState>({ runner: null, version: 0 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('normal');
  /** How the last start happened, so input can resume the same way. */
  const mode = useRef<'play' | 'run' | 'step'>('play');
  /** For the tutorial: how many runs reached the end, and how many of those read input. */
  const [finishedRuns, setFinishedRuns] = useState(0);
  const [runsWithInput, setRunsWithInput] = useState(0);
  const usedInput = useRef(false);
  const countedRunner = useRef<Runner | null>(null);

  // Every edit goes to the draft immediately, so a killed app loses nothing; Save is the named copy.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setDirty(true);
    setPlaying(false);
    saveDraft({ ...chart, name, program });
  }, [program, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    let chosen = name;
    if (!chosen || chosen === t('chart.untitled')) {
      const answer = window.prompt(t('save.prompt'), chosen);
      if (answer === null) return;
      chosen = answer.trim() || t('chart.untitled');
      setName(chosen);
    }
    onSave({ ...chart, name: chosen, program: { ...program, name: chosen } });
    setDirty(false);
  };

  const rename = () => {
    const answer = window.prompt(t('save.prompt'), name);
    if (answer !== null && answer.trim()) setName(answer.trim());
  };

  const exit = () => {
    if (dirty && !confirm(t('exit.confirm'))) return;
    onExit();
  };

  // ---------------------------------------------------------------------------
  // Resizable bottom panel (phones). Drag the tab bar up or down.

  const [panelHeight, setPanelHeight] = useState(() => Math.round(window.innerHeight * 0.46));
  const drag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);
  const onHandleDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startH: panelHeight, moved: false };
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const dy = drag.current.startY - e.clientY;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    if (!drag.current.moved) return;
    const max = window.innerHeight - 140;
    setPanelHeight(Math.min(max, Math.max(56, drag.current.startH + dy)));
    if (!panelOpen) setPanelOpen(true);
  };
  const onHandleUp = () => { drag.current = null; };

  const fn = fnName === null ? null : program.functions.find((f) => f.name === fnName) ?? null;
  const blocks = fn ? fn.body : program.main;

  const compiled = useMemo(() => compile(program), [program]);
  const invalidBlockIds = useMemo(() => new Set(compiled.diagnostics.map((d) => d.blockId).filter((id): id is string => !!id)), [compiled]);

  const layout = useMemo(
    () => layoutBlocks(blocks, { labelOf: (b) => blockLabel(b, i18n), startLabel: fn ? fn.name : t('node.start'), endLabel: t('node.end') }),
    [blocks, i18n, fn, t],
  );

  // ---------------------------------------------------------------------------
  // Editing (the function body currently shown)

  const setBlocks = useCallback((update: (list: Block[]) => Block[]) => {
    setProgram((p) => (fnName === null
      ? { ...p, main: update(p.main) }
      : { ...p, functions: p.functions.map((f) => (f.name === fnName ? { ...f, body: update(f.body) } : f)) }));
  }, [fnName]);

  const insertAt = (kind: Block['kind'], at: Insertion) => {
    const block = defaultBlock(kind, newBlockId(program));
    setBlocks((list) => insertBlock(list, at, block));
    setSheet(block.kind === 'break' ? null : { kind: 'edit', id: block.id });
  };

  const editing = sheet?.kind === 'edit' ? findBlock(blocks, sheet.id) : undefined;

  // ---------------------------------------------------------------------------
  // Running

  const bump = (runner: Runner | null) => {
    setRun((s) => ({ runner, version: s.version + 1 }));
    if (runner?.status === 'waitingInput') usedInput.current = true;
    if (runner?.status === 'finished' && countedRunner.current !== runner) {
      countedRunner.current = runner;
      setFinishedRuns((n) => n + 1);
      if (usedInput.current) setRunsWithInput((n) => n + 1);
    }
  };

  const freshRunner = (): Runner | null => {
    if (!compiled.ok) return null;
    usedInput.current = false;
    const runner = new Runner(compiled.program);
    for (const id of breakpoints) runner.breakpoints.add(id);
    return runner;
  };

  const currentOrFresh = (): Runner | null => {
    const r = run.runner;
    if (r && (r.status === 'paused' || r.status === 'ready')) return r;
    return freshRunner();
  };

  // Play: one block per tick, so the chart lights up block by block and the console fills as it goes.
  useEffect(() => {
    if (!playing) return;
    const r = run.runner;
    if (!r) { setPlaying(false); return; }
    const delay = { slow: 900, normal: 400, fast: 120 }[speed];
    const id = setInterval(() => {
      const status = r.step();
      bump(r);
      if (status !== 'paused' || r.pauseReason === 'breakpoint') setPlaying(false);
    }, delay);
    return () => clearInterval(id);
  }, [playing, speed, run.runner]);

  const onPlay = () => {
    const r = currentOrFresh();
    if (!r) return;
    mode.current = 'play';
    setPanelOpen(true);
    if (r !== run.runner) bump(r);
    setPlaying(true);
  };
  const onPause = () => setPlaying(false);
  const onRun = () => {
    const r = currentOrFresh();
    if (!r) return;
    mode.current = 'run';
    setPlaying(false);
    setPanelOpen(true);
    r.run();
    bump(r);
  };
  const onStep = () => {
    const r = currentOrFresh();
    if (!r) return;
    mode.current = 'step';
    setPanelOpen(true);
    r.step();
    bump(r);
  };
  const onStop = () => { setPlaying(false); bump(null); };
  const onInput = (line: string) => {
    const r = run.runner;
    if (!r) return;
    r.provideInput(line);
    if (r.status === 'ready') {
      if (mode.current === 'run') r.run();
      else if (mode.current === 'step') r.step();
      else setPlaying(true);
    }
    bump(r);
  };

  const runner = run.runner;
  // The chart shows the function the runner is currently in only if it's the one on screen.
  const onScreenFn = fn ? fn.name : 'main';
  const runnerFn = runner ? runner.callStack[runner.callStack.length - 1] : null;
  const currentBlockId = runner && runnerFn === onScreenFn && runner.status !== 'finished' ? runner.currentBlockId : undefined;
  const errorBlockId = runner?.status === 'error' ? runner.error?.blockId : undefined;

  // ---------------------------------------------------------------------------

  return (
    <div className={`app ${panelOpen ? 'panel-open' : ''}`} style={{ ['--panel-height' as string]: `${panelHeight}px` }}>
        <header className="top">
          <button type="button" className="text-button" onClick={exit} aria-label={t('nav.back')}>‹</button>
          <button type="button" className="chart-name" onClick={rename} title={t('save.rename')}>{name}{dirty ? ' •' : ''}</button>
          <button type="button" className="text-button" onClick={save}>{t('save.save')}</button>
          <select className="fn-picker" value={fnName ?? ''} onChange={(e) => { setFnName(e.target.value || null); setSheet(null); }} aria-label="Function">
            <option value="">{t('fn.main')}</option>
            {program.functions.map((f) => <option key={f.name} value={f.name}>{f.name}()</option>)}
          </select>
          <button type="button" className="text-button" onClick={onToggleLang}>{t('menu.language')}</button>
        </header>

        <main className="stage">
          {tutorial && (
            <Coach steps={tutorial} context={{ program, finishedRuns, runsWithInput, tab }} compact={sheet !== null} onFinish={() => { save(); onExit(); }} onSkip={exit} />
          )}
          <ChartCanvas
            layout={layout}
            currentBlockId={currentBlockId}
            errorBlockId={errorBlockId}
            breakpoints={breakpoints}
            invalidBlockIds={invalidBlockIds}
            selectedBlockId={editing?.id}
            followBlockId={currentBlockId}
            onSelectBlock={(id) => setSheet({ kind: 'edit', id })}
            onInsert={(at) => setSheet({ kind: 'insert', at })}
          />

          {sheet?.kind === 'insert' && <InsertMenu at={sheet.at} onPick={insertAt} onClose={() => setSheet(null)} />}
          {editing && (
            <BlockEditor
              key={editing.id}
              block={editing}
              diagnostics={compiled.diagnostics.filter((d) => d.blockId === editing.id)}
              variables={variablesInScope(blocks, editing.id, fn?.params)}
              functionNames={program.functions.map((f) => f.name)}
              breakpoint={breakpoints.has(editing.id)}
              onChange={(b) => setBlocks((list) => updateBlock(list, b.id, () => b))}
              onToggleBreakpoint={() => setBreakpoints((s) => { const n = new Set(s); n.has(editing.id) ? n.delete(editing.id) : n.add(editing.id); return n; })}
              onDelete={() => { setBlocks((list) => deleteBlock(list, editing.id)); setSheet(null); }}
              onClose={() => setSheet(null)}
            />
          )}
        </main>

        <aside className="side">
          <div className="tabs" role="tablist" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
            <span className="grip" aria-hidden="true" />
            <button type="button" role="tab" className={tab === 'run' ? 'on' : ''} aria-selected={tab === 'run'} onClick={() => { setTab('run'); setPanelOpen(true); }}>{t('tab.run')}</button>
            <button type="button" role="tab" className={tab === 'code' ? 'on' : ''} aria-selected={tab === 'code'} onClick={() => { setTab('code'); setPanelOpen(true); }}>{t('tab.code')}</button>
            <button type="button" className="collapse" onClick={() => { if (!drag.current?.moved) setPanelOpen((o) => !o); }} aria-label="Toggle panel">{panelOpen ? '▾' : '▴'}</button>
          </div>
          <div className="side-body">
            {tab === 'run'
              ? <RunPanel compiled={compiled} run={run} playing={playing} speed={speed} onSpeed={setSpeed} onPlay={onPlay} onPause={onPause} onRun={onRun} onStep={onStep} onStop={onStop} onInput={onInput} onSelectBlock={(id) => { setSheet({ kind: 'edit', id }); }} />
              : <CodePanel compiled={compiled} />}
          </div>
        </aside>
    </div>
  );
}
