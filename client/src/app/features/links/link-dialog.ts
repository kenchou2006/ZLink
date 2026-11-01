import { TranslatePipe } from '@ngx-translate/core';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LinksService } from '../../core/api/links.service';
import { Link } from '../../core/models';
import { apiError } from '../../shared/api-error';

/** Convert an ISO timestamp to the `YYYY-MM-DDTHH:mm` value a datetime-local input expects (local time). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

@Component({
  selector: 'app-link-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
    TranslatePipe,
  ],
  templateUrl: './link-dialog.html',
})
export class LinkDialog {
  private fb = inject(FormBuilder);
  private links = inject(LinksService);
  private ref = inject(MatDialogRef<LinkDialog>);
  private snack = inject(MatSnackBar);
  data = inject<Link | null>(MAT_DIALOG_DATA);

  saving = signal(false);
  isEdit = !!this.data;

  form = this.fb.nonNullable.group({
    original_url: [this.data?.original_url ?? '', [Validators.required]],
    short_code: [this.data?.short_code ?? ''],
    neverExpires: [!this.data?.expires_at],
    expiresAt: [this.data?.expires_at ? toLocalInput(this.data.expires_at) : ''],
  });

  save(): void {
    if (this.form.invalid) return;
    const { original_url, short_code, neverExpires, expiresAt } = this.form.getRawValue();
    if (!neverExpires && !expiresAt) {
      this.snack.open('Pick an expiry date or choose "Never expires".', 'Dismiss', { duration: 4000 });
      return;
    }
    this.saving.set(true);
    const payload = {
      original_url,
      short_code,
      expires_at: neverExpires ? null : new Date(expiresAt).toISOString(),
    };
    const req = this.isEdit
      ? this.links.update(this.data!.id, payload)
      : this.links.create(payload);
    req.subscribe({
      next: (link) => this.ref.close(link),
      error: (e) => {
        this.saving.set(false);
        this.snack.open(apiError(e, 'Could not save link.'), 'Dismiss', { duration: 4000 });
      },
    });
  }
}
