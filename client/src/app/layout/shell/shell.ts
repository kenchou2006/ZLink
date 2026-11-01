import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ThemeMode, ThemeService } from '../../core/theme.service';
import { I18nService } from '../../core/i18n.service';

interface NavItem {
  label: string;
  icon: string;
  path: string;
  superuserOnly?: boolean;
}

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatDividerModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    TranslatePipe,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private auth = inject(AuthService);
  private themeSvc = inject(ThemeService);
  private router = inject(Router);
  private breakpoints = inject(BreakpointObserver);
  private i18n = inject(I18nService);

  readonly user = this.auth.user;
  readonly themeMode = this.themeSvc.mode;
  readonly avatarFailed = signal(false);

  // Below tablet width the sidenav becomes an overlay drawer instead of a
  // permanent column, so it doesn't push page content off-screen.
  readonly isMobile = toSignal(
    this.breakpoints.observe(Breakpoints.Handset).pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  // Top-level items. Profile lives in the top-right user menu only.
  private topItems: NavItem[] = [{ label: 'SHELL.LINKS', icon: 'link', path: '/links' }];

  // Items grouped under the "Manage" section.
  private manageGroup: NavItem[] = [
    { label: 'SHELL.API_KEYS', icon: 'vpn_key', path: '/settings/api-keys' },
    { label: 'SHELL.USERS', icon: 'group', path: '/settings/users', superuserOnly: true },
    { label: 'SHELL.CACHE', icon: 'memory', path: '/settings/cache', superuserOnly: true },
  ];

  readonly navItems = this.topItems;

  readonly manageItems = computed(() =>
    this.manageGroup.filter((i) => !i.superuserOnly || this.auth.isSuperuser())
  );

  // Expand "Manage" by default when the user is on one of its pages.
  readonly manageOpen = signal(this.router.url.startsWith('/settings/'));

  toggleManage(): void {
    this.manageOpen.update((v) => !v);
  }

  closeOnMobile(sidenav: MatSidenav): void {
    if (this.isMobile()) sidenav.close();
  }

  setTheme(m: ThemeMode): void {
    this.themeSvc.setMode(m);
  }

  setLanguage(lang: string): void {
    this.i18n.setLanguage(lang);
  }

  get currentLang(): string {
    return this.i18n.currentLang;
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
