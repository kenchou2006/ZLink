import { HttpErrorResponse } from '@angular/common/http';

/** Flatten a DRF error response into a single readable message. */
export function apiError(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof HttpErrorResponse) {
    // Network-level failure (server unreachable, CORS blocked, timeout, offline).
    // err.error is a ProgressEvent here, not a JSON body — never display it.
    if (err.status === 0) {
      return 'Cannot reach the API server. Check that it is running and that CORS allows this origin.';
    }

    const body = err.error;
    if (typeof body === 'string' && body.trim()) return body;

    // Only treat it as a DRF error body if it's a plain object, not a DOM Event.
    if (body && typeof body === 'object' && !(body instanceof Event)) {
      const parts: string[] = [];
      for (const [key, val] of Object.entries(body)) {
        const text = Array.isArray(val) ? val.join(' ') : String(val);
        parts.push(key === 'detail' || key === 'non_field_errors' ? text : `${key}: ${text}`);
      }
      if (parts.length) return parts.join(' · ');
    }

    // Fall back to the HTTP status when there's no usable body.
    return err.statusText && err.status
      ? `Request failed (${err.status} ${err.statusText}).`
      : fallback;
  }
  return fallback;
}
