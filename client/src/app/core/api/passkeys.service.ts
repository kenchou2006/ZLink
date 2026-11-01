import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth.service';
import { ConfigService } from '../config.service';
import { LoginResponse, Passkey } from '../models';

function base64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

@Injectable({ providedIn: 'root' })
export class PasskeysService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private config = inject(ConfigService);
  private get base() {
    return `${this.config.apiBase}/auth/passkeys`;
  }

  /** Whether this browser/context supports WebAuthn at all. */
  get isSupported(): boolean {
    return typeof window !== 'undefined' && !!window.PublicKeyCredential;
  }

  list() {
    return this.http.get<Passkey[]>(`${this.base}/`);
  }

  remove(id: number) {
    return this.http.delete<void>(`${this.base}/${id}/`);
  }

  rename(id: number, name: string) {
    return this.http.patch<Passkey>(`${this.base}/${id}/`, { name });
  }

  /** Run the full registration ceremony and save the resulting passkey. Must be logged in. */
  async register(name: string): Promise<Passkey> {
    const { options, state } = await firstValueFrom(
      this.http.post<{ options: any; state: string }>(`${this.base}/register/options/`, {})
    );

    const publicKey: CredentialCreationOptions['publicKey'] = {
      ...options,
      challenge: base64urlToBuffer(options.challenge),
      user: { ...options.user, id: base64urlToBuffer(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c: any) => ({
        ...c,
        id: base64urlToBuffer(c.id),
      })),
    };

    const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
    if (!credential) throw new Error('Passkey creation was cancelled.');
    const response = credential.response as AuthenticatorAttestationResponse;

    const payload = {
      id: credential.id,
      rawId: credential.id,
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        attestationObject: bufferToBase64url(response.attestationObject),
        transports: response.getTransports?.() ?? [],
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };

    return firstValueFrom(
      this.http.post<Passkey>(`${this.base}/register/verify/`, { state, credential: payload, name })
    );
  }

  /** Run the full passwordless login ceremony (no username needed) and persist the session. */
  async login(): Promise<LoginResponse> {
    const { options, state } = await firstValueFrom(
      this.http.post<{ options: any; state: string }>(`${this.base}/login/options/`, {})
    );

    const publicKey: CredentialRequestOptions['publicKey'] = {
      ...options,
      challenge: base64urlToBuffer(options.challenge),
      allowCredentials: (options.allowCredentials ?? []).map((c: any) => ({
        ...c,
        id: base64urlToBuffer(c.id),
      })),
    };

    const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
    if (!credential) throw new Error('Passkey sign-in was cancelled.');
    const response = credential.response as AuthenticatorAssertionResponse;

    const payload = {
      id: credential.id,
      rawId: credential.id,
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        authenticatorData: bufferToBase64url(response.authenticatorData),
        signature: bufferToBase64url(response.signature),
        userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };

    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${this.base}/login/verify/`, { state, credential: payload })
    );
    this.auth.setSession(res);
    return res;
  }
}
