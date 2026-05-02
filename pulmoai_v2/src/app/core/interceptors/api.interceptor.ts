import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { API_BASE_URL } from '@core/tokens/api-base-url.token';

/**
 * Prepends the API base URL to relative request URLs. Absolute URLs
 * (http://, https://) and asset paths starting with `/i18n/` or `/assets/`
 * are left untouched.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const baseUrl = inject(API_BASE_URL);

  if (isAbsolute(req.url) || isAsset(req.url)) {
    return next(req);
  }

  const path = req.url.startsWith('/') ? req.url : `/${req.url}`;
  return next(req.clone({ url: `${baseUrl}${path}` }));
};

function isAbsolute(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isAsset(url: string): boolean {
  return url.startsWith('/i18n/') || url.startsWith('/assets/');
}
