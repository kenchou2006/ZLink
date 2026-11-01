import { TranslatePipe } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { LinksService } from '../../core/api/links.service';
import { Link } from '../../core/models';
import { apiError } from '../../shared/api-error';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { LinkDialog } from './link-dialog';

@Component({
  selector: 'app-links',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatTableModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  templateUrl: './links.html',
  styleUrl: './links.scss',
})
export class Links implements OnInit {
  private links = inject(LinksService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  data = signal<Link[]>([]);
  loading = signal(false);
  showExpired = signal(false);
  selected = signal<Set<number>>(new Set());
  search = new FormControl('', { nonNullable: true });
  columns = ['select', 'short_code', 'original_url', 'expires_at', 'created_at', 'actions'];

  // Rows actually shown (expired hidden unless toggled on).
  displayed = computed(() =>
    this.showExpired() ? this.data() : this.data().filter((l) => !l.is_expired)
  );
  expiredCount = computed(() => this.data().filter((l) => l.is_expired).length);
  selectedCount = computed(() => this.selected().size);
  allSelected = computed(() => {
    const rows = this.displayed();
    return rows.length > 0 && rows.every((l) => this.selected().has(l.id));
  });
  someSelected = computed(() => this.selectedCount() > 0 && !this.allSelected());

  ngOnInit(): void {
    this.load();
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((v) => this.load(v));
  }

  load(search?: string): void {
    this.loading.set(true);
    this.selected.set(new Set());
    this.links.list(search).subscribe({
      next: (rows) => {
        this.data.set(rows);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.snack.open(apiError(e, 'Failed to load links.'), 'Dismiss', { duration: 4000 });
      },
    });
  }

  toggleShowExpired(checked: boolean): void {
    this.showExpired.set(checked);
    this.selected.set(new Set());
  }

  isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  toggleRow(id: number): void {
    const next = new Set(this.selected());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selected.set(next);
  }

  toggleAll(): void {
    if (this.allSelected()) {
      this.selected.set(new Set());
    } else {
      this.selected.set(new Set(this.displayed().map((l) => l.id)));
    }
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  copy(link: Link): void {
    navigator.clipboard?.writeText(link.short_url);
    this.snack.open('Short URL copied.', undefined, { duration: 1500 });
  }

  openCreate(): void {
    this.dialog
      .open(LinkDialog, { data: null, width: '480px' })
      .afterClosed()
      .subscribe((res) => res && this.afterChange('Link created.'));
  }

  openEdit(link: Link): void {
    this.dialog
      .open(LinkDialog, { data: link, width: '480px' })
      .afterClosed()
      .subscribe((res) => res && this.afterChange('Link updated.'));
  }

  remove(link: Link): void {
    this.confirm(`Delete "${link.short_code}"? This cannot be undone.`, () =>
      this.links.remove(link.id).subscribe({
        next: () => this.afterChange('Link deleted.'),
        error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
      })
    );
  }

  deleteSelected(): void {
    const ids = [...this.selected()];
    this.confirm(`Delete ${ids.length} selected link(s)? This cannot be undone.`, () =>
      this.links.bulkDelete(ids).subscribe({
        next: (r) => this.afterChange(`Deleted ${r.deleted} link(s).`),
        error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
      })
    );
  }

  clearExpired(): void {
    this.confirm(`Delete all ${this.expiredCount()} expired link(s)? This cannot be undone.`, () =>
      this.links.purgeExpired().subscribe({
        next: (r) => this.afterChange(`Deleted ${r.deleted} expired link(s).`),
        error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
      })
    );
  }

  private confirm(message: string, run: () => void): void {
    this.dialog
      .open(ConfirmDialog, {
        data: { title: 'Confirm delete', message, confirmText: 'Delete', destructive: true },
      })
      .afterClosed()
      .subscribe((ok) => ok && run());
  }

  private afterChange(msg: string): void {
    this.snack.open(msg, undefined, { duration: 2000 });
    this.load(this.search.value);
  }
}
