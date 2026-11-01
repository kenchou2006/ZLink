import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ConfigService } from '../config.service';
import { ApiKey, ApiKeyCreated } from '../models';

export interface ApiKeyCreatePayload {
  name: string;
  expires_at: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiKeysService {
  private http = inject(HttpClient);
  private config = inject(ConfigService);
  private get base() {
    return `${this.config.apiBase}/api-keys`;
  }

  list(): Observable<ApiKey[]> {
    return this.http.get<ApiKey[]>(`${this.base}/`);
  }

  create(payload: ApiKeyCreatePayload): Observable<ApiKeyCreated> {
    return this.http.post<ApiKeyCreated>(`${this.base}/`, payload);
  }

  setActive(id: number, isActive: boolean): Observable<ApiKey> {
    return this.http.patch<ApiKey>(`${this.base}/${id}/`, { is_active: isActive });
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  expired(): Observable<ApiKey[]> {
    return this.http.get<ApiKey[]>(`${this.base}/expired/`);
  }

  purgeExpired(): Observable<{ deleted: number }> {
    return this.http.post<{ deleted: number }>(`${this.base}/purge-expired/`, {});
  }
}
