import { useEffect, useState } from 'react';
import { useI18n, type StringKey } from '../i18n';
import type { TutorialContext, TutorialStep } from '../tutorial';

interface Props {
  steps: TutorialStep[];
  context: TutorialContext;
  /** While a sheet is open the coach shrinks to a one-line bar so it never covers the sheet's controls. */
  compact?: boolean;
  onFinish: () => void;
  onSkip: () => void;
}

/**
 * The tutorial's voice: one step at a time above the chart. Steps with a check advance
 * by themselves the moment the chart (or a run) satisfies them; the others have a Next button.
 */
export function Coach({ steps, context, compact, onFinish, onSkip }: Props) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [justDone, setJustDone] = useState(false);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    if (!step.check || !step.check(context)) return;
    setJustDone(true);
    const id = setTimeout(() => { setJustDone(false); setIndex((i) => Math.min(i + 1, steps.length - 1)); }, 700);
    return () => clearTimeout(id);
  }, [context, step, steps.length]);

  if (compact) {
    return (
      <div className={`coach compact ${justDone ? 'done' : ''}`} role="status" aria-live="polite">
        <span className="coach-step">{index + 1}/{steps.length}</span>
        <strong>{justDone ? t('tut.wellDone') : t(`tut.${step.id}.title` as StringKey)}</strong>
      </div>
    );
  }

  return (
    <div className={`coach ${justDone ? 'done' : ''}`} role="status" aria-live="polite">
      <div className="coach-progress">
        {steps.map((s, i) => <span key={s.id} className={i < index ? 'past' : i === index ? 'now' : ''} />)}
      </div>
      <strong>{justDone ? t('tut.wellDone') : t(`tut.${step.id}.title` as StringKey)}</strong>
      <p>{t(`tut.${step.id}.text` as StringKey)}</p>
      <div className="coach-actions">
        {!step.check && !last && <button type="button" className="primary" onClick={() => setIndex(index + 1)}>{t('tut.next')}</button>}
        {last && <button type="button" className="primary" onClick={onFinish}>{t('tut.finish')}</button>}
        {!last && <button type="button" className="text-button" onClick={onSkip}>{t('tut.skip')}</button>}
      </div>
    </div>
  );
}
