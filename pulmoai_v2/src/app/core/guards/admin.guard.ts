import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlTree } from '@angular/router';

import { AuthService } from '@core/services/auth.service';

export const adminGuard: CanMatchFn = (): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/auth/login']);
  }
  if (auth.user()?.role !== 'admin') {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};
