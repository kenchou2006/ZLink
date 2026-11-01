import { TranslatePipe } from '@ngx-translate/core';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiKeysService } from '../../core/api/apikeys.service';
import { ApiKeyCreated } from '../../core/models';
import { apiError } from '../../shared/api-error';

@Component({
  selector: 'app-apikey-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    TranslatePipe,
  ],
  templateUrl: './apikey-dialog.html',
  styles: [`
    .dialog-form { display: flex; flex-direction: column; gap: 8px; }
    .warn-text { display: flex; align-items: center; gap: 6px; color: var(--mat-sys-error); margin-top: 0; }
    .key-box {
      display: flex; align-items: center; gap: 8px;
      background: var(--mat-sys-surface-container-high);
      border-radius: 6px; padding: 8px 12px;
    }
    .key-box code { word-break: break-all; font-size: 0.85rem; flex: 1; }
    .hint { color: var(--mat-sys-on-surface-variant); font-size: 0.85rem; }
    .hint code, .key-box code {
      background: transparent;
    }
  `],
})
export class ApiKeyDialog {
  private fb = inject(FormBuilder);
  private keys = inject(ApiKeysService);
  private ref = inject(MatDialogRef<ApiKeyDialog>);
  private snack = inject(MatSnackBar);

  saving = signal(false);
  created = signal<ApiKeyCreated | null>(null);
  copied = signal(false);

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    neverExpires: [true],
    expiresAt: [''],
  });

  save(): void {
    if (this.form.invalid) return;
    const { name, neverExpires, expiresAt } = this.form.getRawValue();
    if (!neverExpires && !expiresAt) {
      this.snack.open('Please pick an expiry date or choose "Never expires".', 'Dismiss', { duration: 4000 });
      return;
    }
    this.saving.set(true);
    const expires = neverExpires ? null : new Date(expiresAt).toISOString();
    this.keys.create({ name, expires_at: expires }).subscribe({
      next: (key) => {
        this.saving.set(false);
        this.created.set(key);
      },
      error: (e) => {
        this.saving.set(false);
        this.snack.open(apiError(e, 'Could not create API key.'), 'Dismiss', { duration: 4000 });
      },
    });
  }

  copy(): void {
    const key = this.created();
    if (!key) return;
    navigator.clipboard?.writeText(key.key);
    this.copied.set(true);
  }

  done(): void {
    this.ref.close(true);
  }
}
