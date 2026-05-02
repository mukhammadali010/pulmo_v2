import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, switchMap, tap, throwError } from 'rxjs';

import type { AuthResponse, AuthTokens, LoginRequest, RegisterRequest, User } from '@core/models';
import { TokenService } from './token.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenService);
  private readonly router = inject(Router);

  private readonly _user = signal<User | null>(null);
  private readonly _initializing = signal(false);

  readonly user = this._user.asReadonly();
  readonly initializing = this._initializing.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  login(request: LoginRequest): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/auth/login', request)
      .pipe(tap((response) => this.applyAuth(response)));
  }

  register(request: RegisterRequest): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/auth/register', request)
      .pipe(tap((response) => this.applyAuth(response)));
  }

  logout(): void {
    this.tokens.clear();
    this._user.set(null);
    void this.router.navigate(['/auth/login']);
  }

  refresh(): Observable<AuthTokens> {
    const refreshToken = this.tokens.refreshToken;
    if (!refreshToken) {
      return throwError(() => new Error('No refresh token'));
    }
    return this.http
      .post<AuthTokens>('/auth/refresh', { refreshToken })
      .pipe(tap((tokens) => this.tokens.setTokens(tokens)));
  }

  /**
   * Hydrate the current user from a stored token. Used at bootstrap
   * via APP_INITIALIZER so guards see auth state before routing.
   */
  loadCurrentUser(): Observable<User | null> {
    if (!this.tokens.accessToken) return of(null);
    this._initializing.set(true);
    return this.http.get<User>('/auth/me').pipe(
      tap((user) => this._user.set(user)),
      catchError(() => {
        this.tokens.clear();
        this._user.set(null);
        return of(null);
      }),
      switchMap((user) => {
        this._initializing.set(false);
        return of(user);
      }),
    );
  }

  private applyAuth(response: AuthResponse): void {
    this.tokens.setTokens({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    });
    this._user.set(response.user);
  }
}
