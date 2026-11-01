import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ConfigService } from '../config.service';
import { Link } from '../models';

export interface LinkPayload {
  original_url: string;
  short_code?: string;
  expires_at?: string | null;
}

@Injectable({ providedIn: 'root' })
export class LinksService {
  private http = inject(HttpClient);
  private config = inject(ConfigService);
  private get base() {
    return `${this.config.apiBase}/links`;
  }

  list(search?: string): Observable<Link[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<Link[]>(`${this.base}/`, { params });
  }

  create(payload: LinkPayload): Observable<Link> {
    return this.http.post<Link>(`${this.base}/`, payload);
  }

  update(id: number, payload: Partial<LinkPayload>): Observable<Link> {
    return this.http.patch<Link>(`${this.base}/${id}/`, payload);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  expired(): Observable<Link[]> {
    return this.http.get<Link[]>(`${this.base}/expired/`);
  }

  purgeExpired(): Observable<{ deleted: number }> {
    return this.http.post<{ deleted: number }>(`${this.base}/purge-expired/`, {});
  }

  bulkDelete(ids: number[]): Observable<{ deleted: number }> {
    return this.http.post<{ deleted: number }>(`${this.base}/bulk-delete/`, { ids });
  }
}
