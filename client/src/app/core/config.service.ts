import { Injectable, signal } from '@angular/core';

const OVERRIDE_KEY = 'zlink_api_base';

/**
 * Runtime API endpoint configuration.
 *
 * Resolution order on startup:
 *   1. user override saved in localStorage (set via the setup screen)
 *   2. apiBase from /config.json (generated from the API_BASE env var at build/start)
 *   3. empty -> the app sends the user to the setup screen to enter it
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private _apiBase = signal('/api');

  /** Current API base, e.g. "/api" or "https://api.example.com/api" (no trailing slash). */
  get apiBase(): string {
    return this._apiBase();
  }

  get isConfigured(): boolean {
    return this._apiBase().length > 0;
  }

  /** Persist a user-entered endpoint (from the setup screen). */
  setApiBase(value: string): void {
    const cleaned = value.trim().replace(/\/+$/, '');
    this._apiBase.set(cleaned);
    localStorage.setItem(OVERRIDE_KEY, cleaned);
  }

  clear(): void {
    this._apiBase.set('');
    localStorage.removeItem(OVERRIDE_KEY);
  }

  /** Called once during app initialization, before bootstrap completes. */
  async load(): Promise<void> {
    const override = localStorage.getItem(OVERRIDE_KEY);
    if (override) {
      this._apiBase.set(override.replace(/\/+$/, ''));
      return;
    }
    try {
      const res = await fetch('config.json', { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as { apiBase?: string };
        if (json.apiBase) {
          this._apiBase.set(json.apiBase.replace(/\/+$/, ''));
        }
      }
    } catch {
      // No config.json available; fallback to default /api.
    }
    if (!this._apiBase()) {
      this._apiBase.set('/api');
    }
  }
}
