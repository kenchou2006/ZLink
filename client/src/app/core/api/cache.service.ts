import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, expand, reduce } from 'rxjs';
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

  /** The server clears at most 900 keys per call; keep calling until nothing is left. */
  clearAll(): Observable<{ cleared: number }> {
    const clearBatch = () =>
      this.http.post<{ cleared: number; has_more?: boolean }>(`${this.base}/clear/`, {});
    return clearBatch().pipe(
      expand((res) => (res.has_more && res.cleared > 0 ? clearBatch() : EMPTY)),
      reduce((total, res) => ({ cleared: total.cleared + res.cleared }), { cleared: 0 }),
    );
  }
}
