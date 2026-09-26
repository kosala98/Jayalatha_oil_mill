import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts: bundled and precached by the service worker, so they work offline.
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/700.css';
import '@fontsource/work-sans/400.css';
import '@fontsource/work-sans/500.css';
import '@fontsource/work-sans/600.css';
import '@fontsource/noto-sans-sinhala/400.css';
import '@fontsource/noto-sans-sinhala/500.css';
import '@fontsource/noto-sans-sinhala/600.css';
import './styles.css';

import { App } from './App';
import { startOutboxSync } from './offline/outbox';

startOutboxSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
