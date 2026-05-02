import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '@core/services/auth.service';

/**
 * Centralised error handling. Logs the user out on 401, surfaces a toast
 * for everything else, and re-throws so callers can react if needed.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toastr = inject(ToastrService);
  const translate = inject(TranslateService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !req.url.includes('/auth/')) {
        auth.logout();
      } else if (error.status !== 401) {
        const message = resolveMessage(error, translate);
        toastr.error(message);
      }
      return throwError(() => error);
    }),
  );
};

function resolveMessage(error: HttpErrorResponse, translate: TranslateService): string {
  const serverMessage =
    typeof error.error === 'object' && error.error !== null
      ? (error.error as { message?: string }).message
      : null;

  if (serverMessage) return serverMessage;
  if (error.status === 0) return translate.instant('errors.network');
  if (error.status >= 500) return translate.instant('errors.server');
  return error.message;
}
