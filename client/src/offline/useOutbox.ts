import { useEffect, useState } from 'react';
import { type OutboxItem, subscribe } from './outbox';

export function useOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => subscribe(setItems), []);
  return {
    items,
    pending: items.filter((i) => i.status === 'pending'),
    failed: items.filter((i) => i.status === 'failed'),
  };
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
