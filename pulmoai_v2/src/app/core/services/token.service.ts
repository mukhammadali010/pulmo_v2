import { Injectable } from '@angular/core';
import type { AuthTokens } from '@core/models';

const ACCESS_KEY = 'auth.access';
const REFRESH_KEY = 'auth.refresh';

@Injectable({ providedIn: 'root' })
export class TokenService {
  get accessToken(): string | null {
    return this.read(ACCESS_KEY);
  }

  get refreshToken(): string | null {
    return this.read(REFRESH_KEY);
  }

  setTokens(tokens: AuthTokens): void {
    this.write(ACCESS_KEY, tokens.accessToken);
    this.write(REFRESH_KEY, tokens.refreshToken);
  }

  clear(): void {
    this.remove(ACCESS_KEY);
    this.remove(REFRESH_KEY);
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage unavailable — ignore
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
