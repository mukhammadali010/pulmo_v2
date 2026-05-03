import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '@core/services';

import { TokenService } from '@core/services/token.service';
import { catchError, switchMap, throwError } from 'rxjs';

const PUBLIC_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

/**
 * Attaches `Authorization: Bearer <token>` to outgoing requests when an
 * access token is present, except for public auth endpoints.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenService = inject(TokenService);
  const token = tokenService.accessToken;
  const authService = inject(AuthService);

  if (!token || isPublicEndpoint(req.url)) {
    return next(req);
  }

  const authReq = token && !isPublicEndpoint(req.url) ? addToken(req, token) : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && tokenService.refreshToken && !isPublicEndpoint(req.url)) {
        return authService.refresh().pipe(
          switchMap((tokens) => {
            tokenService.setTokens(tokens);
            return next(addToken(req, tokens.accessToken))
          })
        )
      }
      return throwError(() => error);
    })
  );
};

function isPublicEndpoint(url: string): boolean {
  return PUBLIC_PATHS.some((path) => url.includes(path));
}

function addToken(req: HttpRequest<unknown>, token: string) {
  return req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`,
    },
  });
}