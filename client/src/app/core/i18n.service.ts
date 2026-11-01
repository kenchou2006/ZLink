import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const KEY = 'zlink_lang';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private translate = inject(TranslateService);

  init(): void {
    this.translate.addLangs(['en', 'zh-TW']);
    this.translate.setFallbackLang('en');

    const saved = localStorage.getItem(KEY);
    if (saved) {
      this.translate.use(saved);
    } else {
      const browserLang = this.translate.getBrowserCultureLang();
      const defaultLang = browserLang?.match(/zh/i) ? 'zh-TW' : 'en';
      this.translate.use(defaultLang);
      localStorage.setItem(KEY, defaultLang);
    }
  }

  setLanguage(lang: string): void {
    this.translate.use(lang);
    localStorage.setItem(KEY, lang);
  }

  get currentLang(): string {
    return this.translate.currentLang() || this.translate.getFallbackLang() || 'en';
  }
}
