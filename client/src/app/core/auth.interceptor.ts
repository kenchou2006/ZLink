import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, defer, firstValueFrom, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { ConfigService } from './config.service';

// Serializes refresh calls across concurrent requests in this tab AND across
// other tabs (via the Web Locks API, when available) so a second 401 never
// rotates an already-rotated refresh token — see ROTATE_REFRESH_TOKENS note
// in auth.service.ts for why a double rotation logs everyone out.
let pendingRefresh: Promise<string | null> | null = null;

function withRefreshLock(fn: () => Promise<string | null>): Promise<string | null> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) {
    return locks.request('zlink-token-refresh', () => fn()) as unknown as Promise<string | null>;
  }
  if (pendingRefresh) return pendingRefresh;
  const p = fn().finally(() => {
    pendingRefresh = null;
  });
  pendingRefresh = p;
  return p;
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const config = inject(ConfigService);

  // Only attach/refresh tokens for requests to our own API, never third parties.
  const isOwnApiCall = !!config.apiBase && req.url.startsWith(config.apiBase);
  const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/refresh');

  const withAuth = (token: string | null) =>
    token && isOwnApiCall && !isAuthCall
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(withAuth(auth.accessToken)).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401 || !isOwnApiCall || isAuthCall || !auth.refreshToken) {
        return throwError(() => err);
      }

      // Snapshot the refresh token that just failed; if another tab/request
      // already rotated it by the time we get the lock, reuse its result
      // instead of refreshing again with a now-blacklisted token.
      const staleRefreshToken = auth.refreshToken;

      return defer(() =>
        withRefreshLock(async () => {
          if (auth.refreshToken !== staleRefreshToken) {
            return auth.accessToken;
          }
          const res = await firstValueFrom(auth.refresh());
          return res.access;
        })
      ).pipe(
        switchMap((token) => next(withAuth(token))),
        catchError((refreshErr) => {
          auth.clear();
          router.navigate(['/login']);
          return throwError(() => refreshErr);
        })
      );
    })
  );
};
