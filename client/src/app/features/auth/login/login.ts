import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { PasskeysService } from '../../../core/api/passkeys.service';
import { AuthService } from '../../../core/auth.service';
import { apiError } from '../../../shared/api-error';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    TranslatePipe,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private passkeys = inject(PasskeysService);
  private translate = inject(TranslateService);

  loading = signal(false);
  passkeysLoading = signal(false);
  passkeysSupported = this.passkeys.isSupported;

  form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    const { username, password } = this.form.getRawValue();
    this.auth.login(username, password).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/links']);
      },
      error: (e) => {
        this.loading.set(false);
        this.snack.open(apiError(e, 'Invalid username or password.'), 'Dismiss', { duration: 5000 });
      },
    });
  }

  async signInWithPasskey(): Promise<void> {
    this.passkeysLoading.set(true);
    try {
      await this.passkeys.login();
      this.router.navigate(['/links']);
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        // User dismissed the OS passkey picker — not an error worth a toast.
        this.snack.open(this.translate.instant('AUTH.PASSKEY_CANCELLED'), undefined, { duration: 2000 });
      } else {
        this.snack.open(apiError(e, 'Could not sign in with passkey.'), 'Dismiss', { duration: 5000 });
      }
    } finally {
      this.passkeysLoading.set(false);
    }
  }
}
