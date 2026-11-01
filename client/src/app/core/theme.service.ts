import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';
const KEY = 'zlink_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.initial());

  constructor() {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.mode() === 'system') {
        this.apply();
      }
    });
  }

  private initial(): ThemeMode {
    const saved = localStorage.getItem(KEY) as ThemeMode | null;
    return saved ?? 'system';
  }

  apply(): void {
    let activeTheme = this.mode() as string;
    if (activeTheme === 'system') {
      activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', activeTheme);
  }

  setMode(m: ThemeMode): void {
    this.mode.set(m);
    localStorage.setItem(KEY, m);
    this.apply();
  }
}
