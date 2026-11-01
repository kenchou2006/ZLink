import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ConfigService } from '../config.service';
import { User, UserStats } from '../models';

export interface UserCreatePayload {
  username: string;
  email?: string;
  password: string;
  confirm_password: string;
}

export interface UserUpdatePayload {
  username?: string;
  email?: string;
  password?: string;
  confirm_password?: string;
  is_superuser?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private http = inject(HttpClient);
  private config = inject(ConfigService);
  private get base() {
    return `${this.config.apiBase}/users`;
  }

  list(): Observable<User[]> {
    return this.http.get<User[]>(`${this.base}/`);
  }

  stats(): Observable<UserStats> {
    return this.http.get<UserStats>(`${this.base}/stats/`);
  }

  create(payload: UserCreatePayload): Observable<User> {
    return this.http.post<User>(`${this.base}/`, payload);
  }

  update(id: number, payload: UserUpdatePayload): Observable<User> {
    return this.http.patch<User>(`${this.base}/${id}/`, payload);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  toggleActive(id: number): Observable<User> {
    return this.http.post<User>(`${this.base}/${id}/toggle-active/`, {});
  }
}
