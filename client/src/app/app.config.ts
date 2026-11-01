import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';

import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { authInterceptor } from './core/auth.interceptor';
import { ConfigService } from './core/config.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAppInitializer(() => inject(ConfigService).load()),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideTranslateService({ fallbackLang: 'en' }),
    provideTranslateHttpLoader({ prefix: 'i18n/', suffix: '.json' }),
    provideAnimationsAsync(),
  ],
};
