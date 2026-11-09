import type { Program } from '@flowcode/core';

export interface SavedChart {
  id: string;
  name: string;
  program: Program;
  updatedAt: number;
}

const CHARTS = 'flowcode.charts';
const DRAFT = 'flowcode.draft';
const LEGACY = 'flowcode.program';

const read = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the chart still lives in memory.
  }
};

export const emptyProgram = (): Program => ({ version: 1, name: '', main: [], functions: [] });
export const newChartId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Saved charts, newest first. A chart saved by the single-chart version of the app is migrated once. */
export function listCharts(): SavedChart[] {
  let charts = read<SavedChart[]>(CHARTS);
  if (!charts) {
    charts = [];
    const legacy = read<Program>(LEGACY);
    if (legacy && (legacy.main.length || legacy.functions.length)) {
      charts.push({ id: newChartId(), name: legacy.name || 'Chart', program: legacy, updatedAt: Date.now() });
      write(CHARTS, charts);
    }
    localStorage.removeItem(LEGACY);
  }
  return [...charts].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getChart(id: string): SavedChart | undefined {
  return listCharts().find((c) => c.id === id);
}

export function saveChart(chart: SavedChart): SavedChart {
  const saved = { ...chart, updatedAt: Date.now() };
  const charts = listCharts().filter((c) => c.id !== chart.id);
  write(CHARTS, [saved, ...charts]);
  return saved;
}

export function deleteChart(id: string): void {
  write(CHARTS, listCharts().filter((c) => c.id !== id));
}

/** The chart currently open, written on every edit so nothing is lost if the app is killed. */
export const loadDraft = (): SavedChart | null => read<SavedChart>(DRAFT);
export const saveDraft = (chart: SavedChart): void => write(DRAFT, chart);
export const clearDraft = (): void => localStorage.removeItem(DRAFT);
