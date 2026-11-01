import { Injectable } from '@angular/core';

interface AaguidEntry {
  name: string;
  icon_dark?: string;
  icon_light?: string;
}

// jsdelivr mirrors the GitHub repo's raw files with proper CORS headers and
// CDN caching. Fetched with the native `fetch()` API (not HttpClient) so it
// never goes through authInterceptor, which would otherwise attach this
// app's JWT to a third-party request.
const CDN_URL =
  'https://cdn.jsdelivr.net/gh/passkeydeveloper/passkey-authenticator-aaguids@main/aaguid.json';

/**
 * Looks up an authenticator icon (as a data: URI) by AAGUID, fetched once
 * from a public CDN and cached for the session. Never bundled locally —
 * the full icon set is several hundred KB, far more than this app's own code.
 */
@Injectable({ providedIn: 'root' })
export class AaguidIconService {
  private data: Promise<Record<string, AaguidEntry>> | null = null;

  private load(): Promise<Record<string, AaguidEntry>> {
    if (!this.data) {
      this.data = fetch(CDN_URL)
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}));
    }
    return this.data;
  }

  /** Resolves to a data: URI for the icon, or null if unavailable/unrecognized. */
  async icon(aaguid: string | null | undefined, dark: boolean): Promise<string | null> {
    if (!aaguid) return null;
    const data = await this.load();
    const entry = data[aaguid.toLowerCase()];
    if (!entry) return null;
    return (dark ? entry.icon_dark : entry.icon_light) ?? entry.icon_light ?? entry.icon_dark ?? null;
  }
}
