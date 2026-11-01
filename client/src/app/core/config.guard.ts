import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ConfigService } from './config.service';

/** Send the user to the setup screen until an API endpoint is configured. */
export const configGuard: CanActivateFn = () => {
  const config = inject(ConfigService);
  const router = inject(Router);
  return config.isConfigured ? true : router.createUrlTree(['/setup']);
};
