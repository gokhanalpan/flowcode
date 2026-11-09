import type { LanguageId } from '@flowcode/core';
import { LANGUAGES } from '@flowcode/core';

/**
 * Which paid languages are unlocked. This is a stand-in: on Android it becomes Google Play
 * Billing (via a Capacitor plugin or RevenueCat), and the check moves behind a receipt.
 * Keep the UI talking to these two functions only.
 */
const KEY = 'flowcode.unlocked';

const read = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};

export function isUnlocked(language: LanguageId): boolean {
  const info = LANGUAGES.find((l) => l.id === language);
  return info?.free === true || read().has(language);
}

export async function unlock(language: LanguageId): Promise<void> {
  // Placeholder for the purchase flow.
  const set = read();
  set.add(language);
  localStorage.setItem(KEY, JSON.stringify([...set]));
}
