/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Full URL of the API, no trailing slash. Empty = same origin. */
  readonly VITE_API_URL?: string;
  /** https://<ref>.supabase.co. Optional: taken from VITE_API_URL when that is a functions URL. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable key (sb_publishable_...). Only opens the live-update channel. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
