import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ConfigService } from '../config.service';
import { CacheKeysResponse } from '../models';

@Injectable({ providedIn: 'root' })
export class CacheService {
  private http = inject(HttpClient);
  private config = inject(ConfigService);
  private get base() {
    return `${this.config.apiBase}/cache`;
  }

  keys(): Observable<CacheKeysResponse> {
    return this.http.get<CacheKeysResponse>(`${this.base}/keys/`);
  }

  deleteKey(key: string): Observable<{ deleted: boolean; key: string }> {
    return this.http.delete<{ deleted: boolean; key: string }>(`${this.base}/keys/`, {
      body: { key },
    });
  }

  clearAll(): Observable<{ cleared: number }> {
    return this.http.post<{ cleared: number }>(`${this.base}/clear/`, {});
  }
}
