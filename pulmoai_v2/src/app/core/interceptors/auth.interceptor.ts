import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { TokenService } from '@core/services/token.service';

const PUBLIC_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

/**
 * Attaches `Authorization: Bearer <token>` to outgoing requests when an
 * access token is present, except for public auth endpoints.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const tokens = inject(TokenService);
  const token = tokens.accessToken;

  if (!token || isPublicEndpoint(req.url)) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    }),
  );
};

function isPublicEndpoint(url: string): boolean {
  return PUBLIC_PATHS.some((path) => url.includes(path));
}
