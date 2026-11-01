import { TranslatePipe } from '@ngx-translate/core';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UsersService } from '../../core/api/users.service';
import { AuthService } from '../../core/auth.service';
import { User, UserStats } from '../../core/models';
import { apiError } from '../../shared/api-error';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { UserDialog } from './user-dialog';

@Component({
  selector: 'app-users',
  imports: [
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class Users implements OnInit {
  private users = inject(UsersService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private auth = inject(AuthService);

  data = signal<User[]>([]);
  stats = signal<UserStats | null>(null);
  loading = signal(false);
  columns = ['username', 'email', 'role', 'status', 'actions'];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.users.list().subscribe({
      next: (rows) => {
        this.data.set(rows);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.snack.open(apiError(e, 'Failed to load users.'), 'Dismiss', { duration: 4000 });
      },
    });
    this.users.stats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
  }

  isSelf(u: User): boolean {
    return u.id === this.auth.user()?.id;
  }

  openCreate(): void {
    this.dialog
      .open(UserDialog, { data: null, width: '480px' })
      .afterClosed()
      .subscribe((res) => res && this.afterChange('User created.'));
  }

  openEdit(u: User): void {
    this.dialog
      .open(UserDialog, { data: u, width: '480px' })
      .afterClosed()
      .subscribe((res) => res && this.afterChange('User updated.'));
  }

  toggle(u: User): void {
    this.users.toggleActive(u.id).subscribe({
      next: () => this.afterChange(u.is_active ? 'User deactivated.' : 'User activated.'),
      error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
    });
  }

  remove(u: User): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: 'Delete user',
          message: `Delete "${u.username}"? This cannot be undone.`,
          confirmText: 'Delete',
          destructive: true,
        },
      })
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.users.remove(u.id).subscribe({
          next: () => this.afterChange('User deleted.'),
          error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
        });
      });
  }

  private afterChange(msg: string): void {
    this.snack.open(msg, undefined, { duration: 2000 });
    this.load();
  }
}
