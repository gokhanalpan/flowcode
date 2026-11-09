import type { Program } from '@flowcode/core';
import { useState } from 'react';
import { examples } from '../examples';
import { useI18n } from '../i18n';
import { deleteChart, listCharts, type SavedChart } from '../storage';

interface HomeProps {
  draft: SavedChart | null;
  onTutorial: () => void;
  onLoad: () => void;
  onNew: () => void;
  onContinue: () => void;
  onToggleLang: () => void;
}

export function Home({ draft, onTutorial, onLoad, onNew, onContinue, onToggleLang }: HomeProps) {
  const { t } = useI18n();
  return (
    <div className="home">
      <header className="home-top">
        <button type="button" className="text-button" onClick={onToggleLang}>{t('menu.language')}</button>
      </header>
      <div className="home-hero">
        <div className="home-mark" aria-hidden="true">
          <span className="m m-terminal" /><span className="m m-io" /><span className="m m-decision" /><span className="m m-loop" />
        </div>
        <h1>{t('app.title')}</h1>
        <p className="dim">{t('home.tagline')}</p>
      </div>
      <div className="home-actions">
        {draft && (
          <button type="button" className="home-action continue" onClick={onContinue}>
            <strong>{t('home.continue')}</strong>
            <span className="dim">{draft.name}</span>
          </button>
        )}
        <button type="button" className="home-action tutorial" onClick={onTutorial}>
          <strong>{t('home.tutorial')}</strong>
          <span className="dim">{t('home.tutorialHint')}</span>
        </button>
        <button type="button" className="home-action load" onClick={onLoad}>
          <strong>{t('home.load')}</strong>
          <span className="dim">{t('home.loadHint')}</span>
        </button>
        <button type="button" className="home-action new" onClick={onNew}>
          <strong>{t('home.new')}</strong>
          <span className="dim">{t('home.newHint')}</span>
        </button>
      </div>
    </div>
  );
}

interface LoadProps {
  onOpen: (chart: SavedChart) => void;
  onOpenExample: (id: string, program: Program) => void;
  onBack: () => void;
}

export function LoadList({ onOpen, onOpenExample, onBack }: LoadProps) {
  const { t, lang } = useI18n();
  const [charts, setCharts] = useState(() => listCharts());
  const fmt = new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const remove = (c: SavedChart) => {
    if (!confirm(t('load.confirmDelete', { name: c.name }))) return;
    deleteChart(c.id);
    setCharts(listCharts());
  };

  return (
    <div className="home list-screen">
      <header className="home-top">
        <button type="button" className="text-button" onClick={onBack}>‹ {t('nav.back')}</button>
        <strong>{t('home.load')}</strong>
      </header>
      <section>
        <h2>{t('load.mine')}</h2>
        {charts.length === 0 && <p className="hint">{t('load.none')}</p>}
        <ul className="chart-list">
          {charts.map((c) => (
            <li key={c.id}>
              <button type="button" className="chart-item" onClick={() => onOpen(c)}>
                <strong>{c.name}</strong>
                <span className="dim">{fmt.format(c.updatedAt)} · {c.program.main.length} {t('load.blocks')}</span>
              </button>
              <button type="button" className="text-button danger" onClick={() => remove(c)} aria-label={t('load.delete')}>✕</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>{t('menu.examples')}</h2>
        <ul className="chart-list">
          {examples.map((e) => (
            <li key={e.id}>
              <button type="button" className="chart-item" onClick={() => onOpenExample(e.id, e.program)}>
                <strong>{e.program.name ?? e.id}</strong>
                <span className="dim">{e.program.main.length} {t('load.blocks')}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
