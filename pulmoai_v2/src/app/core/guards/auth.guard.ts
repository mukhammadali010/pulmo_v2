import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlTree } from '@angular/router';

import { AuthService } from '@core/services/auth.service';

export const authGuard: CanMatchFn = (_route, segments): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  const attemptedUrl = '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/auth/login'], {
    queryParams: { redirectTo: attemptedUrl },
  });
};
