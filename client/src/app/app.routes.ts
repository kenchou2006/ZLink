import { Routes } from '@angular/router';
import { authGuard, superuserGuard } from './core/auth.guard';
import { configGuard } from './core/config.guard';

export const routes: Routes = [
  {
    path: 'setup',
    loadComponent: () => import('./features/setup/setup').then((m) => m.Setup),
  },
  {
    path: 'login',
    canActivate: [configGuard],
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell/shell').then((m) => m.Shell),
    canActivate: [configGuard, authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'links' },
      {
        path: 'links',
        loadComponent: () => import('./features/links/links').then((m) => m.Links),
      },
      {
        path: 'settings/profile',
        loadComponent: () => import('./features/profile/profile').then((m) => m.Profile),
      },
      {
        path: 'settings/api-keys',
        loadComponent: () => import('./features/apikeys/apikeys').then((m) => m.ApiKeys),
      },
      {
        path: 'settings/users',
        canActivate: [superuserGuard],
        loadComponent: () => import('./features/users/users').then((m) => m.Users),
      },
      {
        path: 'settings/cache',
        canActivate: [superuserGuard],
        loadComponent: () => import('./features/cache/cache').then((m) => m.Cache),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
