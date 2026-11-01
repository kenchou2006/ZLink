import { TranslatePipe } from '@ngx-translate/core';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CacheService } from '../../core/api/cache.service';
import { CacheKey } from '../../core/models';
import { apiError } from '../../shared/api-error';
import { ConfirmDialog } from '../../shared/confirm-dialog';

@Component({
  selector: 'app-cache',
  imports: [
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  templateUrl: './cache.html',
  styleUrl: './cache.scss',
})
export class Cache implements OnInit {
  private cache = inject(CacheService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  data = signal<CacheKey[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  columns = ['display_key', 'ttl', 'type', 'actions'];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.cache.keys().subscribe({
      next: (res) => {
        this.data.set(res.keys);
        this.error.set(res.error);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(apiError(e, 'Redis is unavailable.'));
        this.data.set([]);
      },
    });
  }

  deleteKey(k: CacheKey): void {
    this.cache.deleteKey(k.key).subscribe({
      next: () => {
        this.snack.open('Key deleted.', undefined, { duration: 2000 });
        this.load();
      },
      error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
    });
  }

  clearAll(): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: 'Clear all cache',
          message: 'Remove all cached short-link keys from Redis?',
          confirmText: 'Clear all',
          destructive: true,
        },
      })
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.cache.clearAll().subscribe({
          next: (res) => {
            this.snack.open(`Cleared ${res.cleared} keys.`, undefined, { duration: 2500 });
            this.load();
          },
          error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
        });
      });
  }

  ttlLabel(ttl: number): string {
    if (ttl < 0) return 'persistent';
    return `${ttl}s`;
  }
}
