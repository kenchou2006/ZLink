import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ConfigService } from './config.service';
import { LoginResponse, User } from './models';

const ACCESS_KEY = 'zlink_access';
const REFRESH_KEY = 'zlink_refresh';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private config = inject(ConfigService);
  private get base() {
    return this.config.apiBase;
  }

  readonly user = signal<User | null>(null);
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly isSuperuser = computed(() => this.user()?.is_superuser ?? false);

  constructor() {
    // Tokens are shared via localStorage, but the `user` signal is per-tab.
    // If another tab clears the refresh token (logout, or a failed refresh),
    // mirror that here instead of letting this tab keep acting as logged in.
    window.addEventListener('storage', (event) => {
      if (event.key === REFRESH_KEY && event.newValue === null) {
        this.user.set(null);
      }
    });
  }

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  }
  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.base}/auth/login/`, { username, password })
      .pipe(tap((res) => this.setSession(res)));
  }

  /** Persist tokens + user from any login-shaped response (password or passkey). */
  setSession(res: LoginResponse): void {
    localStorage.setItem(ACCESS_KEY, res.access);
    localStorage.setItem(REFRESH_KEY, res.refresh);
    this.user.set(res.user);
  }

  refresh(): Observable<{ access: string; refresh?: string }> {
    return this.http
      .post<{ access: string; refresh?: string }>(`${this.base}/auth/refresh/`, {
        refresh: this.refreshToken,
      })
      .pipe(
        tap((res) => {
          // ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION means each refresh call
          // invalidates the old refresh token server-side, so the new one in the
          // response must replace it — otherwise the *next* refresh fails and logs
          // the user out, even though this call succeeded.
          localStorage.setItem(ACCESS_KEY, res.access);
          if (res.refresh) localStorage.setItem(REFRESH_KEY, res.refresh);
        })
      );
  }

  /** Load the current user; used by the bootstrap guard on refresh. */
  loadMe(): Observable<User> {
    return this.http
      .get<User>(`${this.base}/auth/me/`)
      .pipe(tap((u) => this.user.set(u)));
  }

  logout(): void {
    const refresh = this.refreshToken;
    if (refresh) {
      this.http.post(`${this.base}/auth/logout/`, { refresh }).subscribe({
        next: () => {},
        error: () => {},
      });
    }
    this.clear();
  }

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.user.set(null);
  }

  setAccess(token: string): void {
    localStorage.setItem(ACCESS_KEY, token);
  }
}
