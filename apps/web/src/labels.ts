import type { Block } from '@flowcode/core';
import type { I18n } from './i18n';

/** One-line summary of a block for the chart node. */
export function blockLabel(b: Block, i18n: I18n): string {
  const { t } = i18n;
  switch (b.kind) {
    case 'declare': return `${t('label.declare')} ${b.name}${b.size !== undefined ? `[${b.size}]` : ''}: ${t(`type.${b.type}`)}`;
    case 'assign': return `${b.target}${b.index !== undefined ? `[${b.index}]` : ''} = ${b.value}`;
    case 'input': return `${t('label.input')} ${b.target}${b.index !== undefined ? `[${b.index}]` : ''}`;
    case 'output': return `${t('label.output')} ${b.value}`;
    case 'if': return b.condition;
    case 'while': return i18n.lang === 'tr' ? `${b.condition} ${t('label.while')}` : `${t('label.while')} ${b.condition}`;
    case 'doWhile': return i18n.lang === 'tr' ? `${b.condition} ${t('label.doWhile')}` : `${t('label.doWhile')} ${b.condition}`;
    case 'for': {
      const step = b.step !== undefined && b.step !== 1 ? ` ${t('label.step')} ${b.step}` : '';
      return i18n.lang === 'tr' ? `${b.variable} = ${b.from} … ${b.to}${step} ${t('label.for')}` : `${t('label.for')} ${b.variable} = ${b.from} … ${b.to}${step}`;
    }
    case 'call': return `${b.name}(${b.args.join(', ')})`;
    case 'comment': return b.text || t('label.comment');
    case 'break': return t('label.break');
    case 'return': return `${t('label.return')}${b.value !== undefined ? ` ${b.value}` : ''}`;
  }
}
