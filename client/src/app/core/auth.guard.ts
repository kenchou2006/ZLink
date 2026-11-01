import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

/** Allow only authenticated users. Re-hydrates the user via /me on hard refresh. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;
  if (!auth.accessToken && !auth.refreshToken) {
    return router.createUrlTree(['/login']);
  }
  return auth.loadMe().pipe(
    map(() => true),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};

/** Allow only superusers. */
export const superuserGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const check = () =>
    auth.isSuperuser() ? true : router.createUrlTree(['/links']);

  if (auth.user()) return check();
  return auth.loadMe().pipe(
    map(check),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};
