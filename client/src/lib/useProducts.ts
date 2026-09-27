import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { FALLBACK_PRODUCTS } from '../domain/catalog';
import type { Product } from '../domain/types';
import { useLiveRefresh } from './live';

/** Server catalog when reachable (service worker caches it), bundled copy otherwise. */
export function useProducts(): Product[] {
  const [products, setProducts] = useState<Product[]>(FALLBACK_PRODUCTS);

  const load = useCallback((isCancelled: () => boolean = () => false) => {
    api
      .products()
      .then((list) => {
        if (!isCancelled() && Array.isArray(list) && list.length > 0) setProducts(list);
      })
      .catch(() => {
        /* offline with an empty cache — the bundled catalog is already showing */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  useLiveRefresh(['products'], () => load());
  return products;
}
