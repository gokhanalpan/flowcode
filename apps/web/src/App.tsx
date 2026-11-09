import type { Program } from '@flowcode/core';
import { useEffect, useMemo, useState } from 'react';
import { Editor } from './components/Editor';
import { Home, LoadList } from './components/Home';
import { detectLang, I18nContext, makeI18n, type Lang } from './i18n';
import { clearDraft, emptyProgram, loadDraft, newChartId, saveChart, type SavedChart } from './storage';
import { helloTutorial } from './tutorial';

type Screen = { kind: 'home' } | { kind: 'load' } | { kind: 'editor'; chart: SavedChart; tutorial?: boolean };

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [draft, setDraft] = useState<SavedChart | null>(loadDraft);

  useEffect(() => localStorage.setItem('flowcode.lang', lang), [lang]);

  // Android's back button / browser back returns to the home screen instead of leaving the app.
  useEffect(() => {
    const onPop = () => setScreen({ kind: 'home' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (next: Screen) => {
    if (next.kind !== 'home') history.pushState(null, '');
    setScreen(next);
  };
  const home = () => {
    setDraft(loadDraft());
    setScreen({ kind: 'home' });
  };

  const openNew = (program: Program = emptyProgram(), name = i18n.t('chart.untitled'), tutorial = false) =>
    go({ kind: 'editor', chart: { id: newChartId(), name, program: { ...program, name }, updatedAt: Date.now() }, tutorial });

  const toggleLang = () => setLang(lang === 'en' ? 'tr' : 'en');

  return (
    <I18nContext.Provider value={i18n}>
      {screen.kind === 'home' && (
        <Home
          draft={draft}
          onTutorial={() => openNew(emptyProgram(), i18n.t('tut.chartName'), true)}
          onLoad={() => go({ kind: 'load' })}
          onNew={() => openNew()}
          onContinue={() => draft && go({ kind: 'editor', chart: draft })}
          onToggleLang={toggleLang}
        />
      )}
      {screen.kind === 'load' && (
        <LoadList
          onBack={home}
          onOpen={(chart) => go({ kind: 'editor', chart })}
          onOpenExample={(_id, program) => openNew(program, program.name)}
        />
      )}
      {screen.kind === 'editor' && (
        <Editor
          key={screen.chart.id}
          chart={screen.chart}
          tutorial={screen.tutorial ? helloTutorial : undefined}
          onSave={(chart) => { saveChart(chart); clearDraft(); }}
          onExit={home}
          onToggleLang={toggleLang}
        />
      )}
    </I18nContext.Provider>
  );
}
