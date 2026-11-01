import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ConfigService } from '../config.service';
import { User } from '../models';

export interface ProfilePayload {
  username?: string;
  email?: string;
  avatar_url?: string;
  current_password?: string;
  new_password?: string;
  confirm_password?: string;
  password_login_disabled?: boolean;
}

export interface ProfileUpdateResponse {
  user: User;
  password_changed: boolean;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private http = inject(HttpClient);
  private config = inject(ConfigService);
  private get base() {
    return `${this.config.apiBase}/profile`;
  }

  get(): Observable<User> {
    return this.http.get<User>(`${this.base}/`);
  }

  update(payload: ProfilePayload): Observable<ProfileUpdateResponse> {
    return this.http.patch<ProfileUpdateResponse>(`${this.base}/`, payload);
  }
}
