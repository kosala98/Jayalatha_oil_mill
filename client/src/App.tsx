import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { SessionProvider, useSession } from './auth/Session';
import { Bill } from './components/Bill';
import { PricesDialog } from './components/PricesDialog';
import { StatusBar } from './components/StatusBar';
import { ToastProvider } from './components/Toast';
import { UpdatePrompt } from './components/UpdatePrompt';
import { closeBill, useBill } from './domain/billStore';
import { S } from './i18n';
import { setTabNavigator } from './lib/navigation';
import { AdminScreen } from './screens/AdminScreen';
import { CashScreen } from './screens/CashScreen';
import { CombinedScreen } from './screens/CombinedScreen';
import { CustomersScreen } from './screens/CustomersScreen';
import { LoginScreen } from './screens/LoginScreen';
import { PurchaseScreen } from './screens/PurchaseScreen';
import { SaleScreen } from './screens/SaleScreen';

type Tab = 'sale' | 'purchase' | 'cash' | 'combined' | 'customers' | 'admin';
const COUNTER_TABS: Tab[] = ['sale', 'purchase', 'cash', 'customers'];

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { session, canSeeAdmin, isTemporaryAdmin, logout } = useSession();
  const [tab, setTab] = useState<Tab>('sale');
  const [pricesOpen, setPricesOpen] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // The admin tab only exists for the owner, or while a lent window is open.
  // Screens can hand the cashier to another tab mid-transaction.
  useEffect(() => {
    setTabNavigator((next) => (next === 'combined' ? setSettling(true) : setTab(next as Tab)));
    return () => setTabNavigator(null);
  }, []);

  // Settling a visit is a moment, not a place: it covers the screen when the counter
  // asks for it and is gone again afterwards, so the tab bar stays as it was.
  const [settling, setSettling] = useState(false);
  const bill = useBill();
  const tabs = useMemo<Tab[]>(() => (canSeeAdmin ? [...COUNTER_TABS, 'admin'] : COUNTER_TABS), [canSeeAdmin]);
  const current = tabs.includes(tab) ? tab : 'sale';

  function onTabKey(e: KeyboardEvent, i: number) {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const next = (i + d + tabs.length) % tabs.length;
    setTab(tabs[next]!);
    refs.current[next]?.focus();
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1 className="masthead__name">
          {S.app.name} <span className="masthead__tag">{S.app.tagline}</span>
        </h1>
        {session && (
          <div className="masthead__actions">
            <button type="button" className="masthead__prices" onClick={() => setPricesOpen(true)}>
              {S.prices.open}
            </button>
            <StatusBar />
          </div>
        )}
      </header>

      {/* Nothing at all before a PIN is entered — not even the tabs. */}
      {!session ? (
        <main className="panel">
          <LoginScreen />
        </main>
      ) : (
        <>
          <nav className="tabs" role="tablist" aria-label={S.app.name}>
            {tabs.map((id, i) => (
              <button
                key={id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                id={`tab-${id}`}
                role="tab"
                type="button"
                aria-selected={current === id}
                aria-controls={`panel-${id}`}
                tabIndex={current === id ? 0 : -1}
                className={`tabs__tab ${id === 'admin' && isTemporaryAdmin ? 'tabs__tab--temp' : ''}`}
                onClick={() => setTab(id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {S.tabs[id]}
              </button>
            ))}
            <button type="button" className="tabs__signout" onClick={logout}>
              {S.auth.signOut}
            </button>
          </nav>

          <UpdatePrompt />
          <PricesDialog open={pricesOpen} onClose={() => setPricesOpen(false)} />

          {bill && (
            <main className="panel panel--overlay">
              <Bill data={bill} onClose={closeBill} />
            </main>
          )}

          {settling && !bill && (
            <main className="panel panel--overlay">
              <CombinedScreen onBack={() => setSettling(false)} onSaved={() => setSettling(false)} />
            </main>
          )}

          {/* Entry screens stay mounted so a half-typed sale survives a quick look at another tab. */}
          {tabs.map((id) => (
            <main key={id} id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} hidden={current !== id || settling || bill !== null} className="panel">
              {id === 'sale' && <SaleScreen />}
              {id === 'purchase' && <PurchaseScreen />}
              {id === 'cash' && <CashScreen />}
              {id === 'combined' && <CombinedScreen />}
              {/* Mounted only while it is the open tab: a profile read earlier would
                  otherwise still show the balance from before this morning's sales. */}
              {id === 'customers' && current === id && <CustomersScreen />}
              {id === 'admin' && current === 'admin' && <AdminScreen />}
            </main>
          ))}
        </>
      )}
    </div>
  );
}
