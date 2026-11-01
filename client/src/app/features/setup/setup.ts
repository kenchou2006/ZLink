import { TranslatePipe } from '@ngx-translate/core';
import { HttpClient } from '@angular/common/http';
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
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '../../core/config.service';

@Component({
  selector: 'app-setup',
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
  templateUrl: './setup.html',
  styleUrl: './setup.scss',
})
export class Setup {
  private fb = inject(FormBuilder);
  private config = inject(ConfigService);
  private http = inject(HttpClient);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  testing = signal(false);

  form = this.fb.nonNullable.group({
    apiBase: [this.config.apiBase || 'http://localhost:8000/api', [Validators.required]],
  });

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.testing.set(true);
    const base = this.form.getRawValue().apiBase.trim().replace(/\/+$/, '');

    try {
      // Probe the health endpoint to confirm the URL is reachable & correct.
      await firstValueFrom(this.http.get(`${base}/healthz/`));
      this.config.setApiBase(base);
      this.router.navigate(['/login']);
    } catch {
      this.snack.open(
        `Could not reach ${base}/healthz/. Check the URL and that the API allows this origin (CORS).`,
        'Dismiss',
        { duration: 6000 },
      );
    } finally {
      this.testing.set(false);
    }
  }
}
