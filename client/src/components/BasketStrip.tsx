import { clearBasket, useBasket } from '../domain/basket';
import { useToast } from '../components/Toast';
import { S, t } from '../i18n';
import { goToTab } from '../lib/navigation';

/**
 * Sits at the top of the sale and purchase screens once a visit is under way, so the
 * cashier always knows there is an unfinished transaction and what is left to settle.
 */
export function BasketStrip() {
  const lines = useBasket();
  const toast = useToast();
  if (lines.length === 0) return null;

  return (
    <div className="basket-strip">
      <button type="button" className="basket-strip__open" onClick={() => goToTab('combined')}>
        <span className="basket-strip__net">{t(S.basket.inProgress, { n: lines.length })}</span>
        <span className="basket-strip__go">{S.basket.finish} →</span>
      </button>
      {/* Started one by mistake? Nothing has been recorded yet, so it can simply go. */}
      <button
        type="button"
        className="basket-strip__discard"
        aria-label={S.basket.discard}
        title={S.basket.discard}
        onClick={() => {
          if (window.confirm(S.basket.discardConfirm)) {
            clearBasket();
            toast(S.basket.discarded, 'success');
          }
        }}
      >
        ✕
      </button>
    </div>
  );
}
