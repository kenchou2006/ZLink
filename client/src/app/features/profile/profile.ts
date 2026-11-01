import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { findAuthenticatorById } from 'passkey-authenticator-aaguids';
import { AaguidIconService } from '../../core/aaguid-icon.service';
import { PasskeysService } from '../../core/api/passkeys.service';
import { ProfileService } from '../../core/api/profile.service';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../shared/api-error';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { Passkey } from '../../core/models';

@Component({
  selector: 'app-profile',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSlideToggleModule,
    MatTooltipModule,
    TranslatePipe,
    DatePipe,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile implements OnInit {
  private fb = inject(FormBuilder);
  private profile = inject(ProfileService);
  private auth = inject(AuthService);
  private snack = inject(MatSnackBar);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private translate = inject(TranslateService);
  private aaguidIcons = inject(AaguidIconService);
  passkeys = inject(PasskeysService);

  savingAccount = signal(false);
  savingPassword = signal(false);
  passkeyList = signal<Passkey[]>([]);
  passkeyIcons = signal<Record<string, string>>({});
  addingPasskey = signal(false);
  passwordLoginDisabled = signal(false);
  togglingPasswordLogin = signal(false);
  newPasskeyName = '';

  accountForm = this.fb.nonNullable.group({
    username: [''],
    email: [''],
    avatar_url: [''],
  });

  passwordForm = this.fb.nonNullable.group({
    current_password: [''],
    new_password: [''],
    confirm_password: [''],
  });

  ngOnInit(): void {
    const u = this.auth.user();
    if (u) {
      this.accountForm.patchValue({
        username: u.username,
        email: u.email,
        avatar_url: u.avatar_url ?? '',
      });
      this.passwordLoginDisabled.set(u.password_login_disabled);
    }
    if (this.passkeys.isSupported) this.loadPasskeys();
  }

  loadPasskeys(): void {
    this.passkeys.list().subscribe({
      next: (list) => {
        this.passkeyList.set(list);
        this.loadIcons(list);
      },
      error: () => {},
    });
  }

  private loadIcons(list: Passkey[]): void {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    for (const p of list) {
      if (!p.aaguid || this.passkeyIcons()[p.aaguid]) continue;
      this.aaguidIcons.icon(p.aaguid, dark).then((icon) => {
        if (icon) this.passkeyIcons.update((m) => ({ ...m, [p.aaguid]: icon }));
      });
    }
  }

  icon(p: Passkey): string | null {
    return this.passkeyIcons()[p.aaguid] ?? null;
  }

  async addPasskey(): Promise<void> {
    const name = this.newPasskeyName.trim() || 'Passkey';
    this.addingPasskey.set(true);
    try {
      await this.passkeys.register(name);
      this.newPasskeyName = '';
      this.loadPasskeys();
      this.snack.open('Passkey added.', undefined, { duration: 2000 });
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') {
        this.snack.open(apiError(e, 'Could not add passkey.'), 'Dismiss', { duration: 4000 });
      }
    } finally {
      this.addingPasskey.set(false);
    }
  }

  removePasskey(p: Passkey): void {
    this.dialog
      .open(ConfirmDialog, {
        data: {
          title: this.translate.instant('PROFILE.DELETE_PASSKEY_TITLE'),
          message: this.translate.instant('PROFILE.DELETE_PASSKEY_MESSAGE', { name: p.name }),
          destructive: true,
        },
      })
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.passkeys.remove(p.id).subscribe({
          next: () => {
            this.loadPasskeys();
            // Removing the last passkey while password login was disabled
            // re-enables it server-side (lockout safety net) — resync.
            if (this.passwordLoginDisabled() && this.passkeyList().length <= 1) {
              this.auth.loadMe().subscribe((u) => this.passwordLoginDisabled.set(u.password_login_disabled));
            }
          },
          error: (e) => this.snack.open(apiError(e), 'Dismiss', { duration: 4000 }),
        });
      });
  }

  togglePasswordLogin(disabled: boolean): void {
    this.togglingPasswordLogin.set(true);
    this.profile.update({ password_login_disabled: disabled }).subscribe({
      next: (res) => {
        this.togglingPasswordLogin.set(false);
        this.auth.user.set(res.user);
        this.passwordLoginDisabled.set(res.user.password_login_disabled);
        this.snack.open(
          disabled ? 'Password login disabled.' : 'Password login re-enabled.',
          undefined,
          { duration: 2000 },
        );
      },
      error: (e) => {
        this.togglingPasswordLogin.set(false);
        this.snack.open(apiError(e, 'Could not update password login setting.'), 'Dismiss', { duration: 4000 });
      },
    });
  }

  /** e.g. "Google Password Manager", or null if the authenticator isn't recognized. */
  providerName(p: Passkey): string | null {
    if (!p.aaguid) return null;
    return findAuthenticatorById({ authenticatorId: p.aaguid })?.name ?? null;
  }

  saveAccount(): void {
    this.savingAccount.set(true);
    this.profile.update(this.accountForm.getRawValue()).subscribe({
      next: (res) => {
        this.savingAccount.set(false);
        this.auth.user.set(res.user);
        this.snack.open('Profile updated.', undefined, { duration: 2000 });
      },
      error: (e) => {
        this.savingAccount.set(false);
        this.snack.open(apiError(e, 'Could not update profile.'), 'Dismiss', { duration: 4000 });
      },
    });
  }

  changePassword(): void {
    this.savingPassword.set(true);
    this.profile.update(this.passwordForm.getRawValue()).subscribe({
      next: (res) => {
        this.savingPassword.set(false);
        this.auth.user.set(res.user);
        if (res.password_changed) {
          this.snack.open('Password changed. Please sign in again.', undefined, { duration: 3000 });
          this.auth.clear();
          this.router.navigate(['/login']);
        } else {
          this.passwordForm.reset();
        }
      },
      error: (e) => {
        this.savingPassword.set(false);
        this.snack.open(apiError(e, 'Could not change password.'), 'Dismiss', { duration: 4000 });
      },
    });
  }
}
