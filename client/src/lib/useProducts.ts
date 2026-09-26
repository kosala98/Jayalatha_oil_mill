import { useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { FALLBACK_PRODUCTS } from '../domain/catalog';
import type { Product } from '../domain/types';

/** Server catalog when reachable (service worker caches it), bundled copy otherwise. */
export function useProducts(): Product[] {
  const [products, setProducts] = useState<Product[]>(FALLBACK_PRODUCTS);
  useEffect(() => {
    let cancelled = false;
    api
      .products()
      .then((list) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) setProducts(list);
      })
      .catch(() => {
        /* offline with an empty cache — the bundled catalog is already showing */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return products;
}
