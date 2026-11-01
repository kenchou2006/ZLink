import { TranslatePipe } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiKeysService } from '../../core/api/apikeys.service';
import { ApiKey } from '../../core/models';
import { apiError } from '../../shared/api-error';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { ApiKeyDialog } from './apikey-dialog';

function isExpired(k: ApiKey): boolean {
  return !!k.expires_at && new Date(k.expires_at) <= new Date();
}

@Component({
  selector: 'app-apikeys',
  imports: [
    DatePipe,
    MatTableModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  templateUrl: './apikeys.html',
  styleUrl: './apikeys.scss',
})
export class ApiKeys implements OnInit {
  private keys = inject(ApiKeysService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  data = signal<ApiKey[]>([]);
  loading = signal(false);
  showExpired = signal(false);
  columns = ['name', 'prefix', 'status', 'expires_at', 'last_used_at', 'actions'];

  displayed = computed(() =>
    this.showExpired() ? this.data() : this.data().filter((k) => !isExpired(k))
  );
  expiredCount = computed(() => this.data().filter(isExpired).length);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.keys.list().subscribe({
      next: (rows) => {
        this.data.set(rows);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.snack.open(apiError(e, 'Failed to load API keys.'), 'Dismiss', { duration: 4000 });
      },
    });
  }

  status(k: ApiKey): string {
    if (!k.is_active) return 'Revoked';
    if (isExpired(k)) return 'Expired';
    return 'Active';
  }

  clearExpired(): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: 'Clear expired keys',
          message: `Delete all ${this.expiredCount()} expired API key(s)? This cannot be undone.`,
          confirmText: 'Clear expired',
          destructive: true,
        },
      })
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.keys.purgeExpired().subscribe({
          next: (r) => {
            this.snack.open(`Deleted ${r.deleted} expired key(s).`, undefined, { duration: 2500 });
            this.load();
          },
          error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
        });
      });
  }

  openCreate(): void {
    this.dialog
      .open(ApiKeyDialog, { width: '480px', disableClose: true })
      .afterClosed()
      .subscribe((res) => res && this.load());
  }

  toggle(k: ApiKey): void {
    this.keys.setActive(k.id, !k.is_active).subscribe({
      next: () => {
        this.snack.open(k.is_active ? 'Key revoked.' : 'Key re-enabled.', undefined, { duration: 2000 });
        this.load();
      },
      error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
    });
  }

  remove(k: ApiKey): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: 'Delete API key',
          message: `Delete "${k.name}"? Any client using it will stop working.`,
          confirmText: 'Delete',
          destructive: true,
        },
      })
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.keys.remove(k.id).subscribe({
          next: () => {
            this.snack.open('Key deleted.', undefined, { duration: 2000 });
            this.load();
          },
          error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
        });
      });
  }
}
