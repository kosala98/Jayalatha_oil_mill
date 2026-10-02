import { useCallback, useState } from 'react';

/**
 * Per-device switch: print every bill the moment it is shown. Meant for the counter PC
 * with a receipt printer as its default printer and Chrome started with
 * --kiosk-printing, where printing then needs no click at all. Off by default, so a
 * phone never opens a print dialog unasked.
 */
const KEY = 'pos.autoPrint';

export function isAutoPrintOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function useAutoPrint(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(isAutoPrintOn);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked: the switch lasts for this page only */
    }
  }, []);
  return [on, set];
}
