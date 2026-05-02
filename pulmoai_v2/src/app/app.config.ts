import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';
import { provideToastr } from 'ngx-toastr';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideMarkdown } from 'ngx-markdown';
import { firstValueFrom } from 'rxjs';

import { environment } from '@env/environment';
import { API_BASE_URL } from '@core/tokens/api-base-url.token';
import { AuthService } from '@core/services/auth.service';
import { LanguageService, SUPPORTED_LANGUAGES } from '@core/services/language.service';
import { apiInterceptor, authInterceptor, errorInterceptor } from '@core/interceptors';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withInterceptors([apiInterceptor, authInterceptor, errorInterceptor])),
    provideAnimationsAsync(),
    provideAppInitializer(async () => {
      const language = inject(LanguageService);
      const translate = inject(TranslateService);
      const auth = inject(AuthService);
      await firstValueFrom(translate.use(language.current()));
      // Preload remaining languages in the background so switching is instant
      // and doesn't fail if a single fetch hits a transient error.
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang === language.current()) continue;
        translate.reloadLang(lang).subscribe({ error: () => {} });
      }
      await firstValueFrom(auth.loadCurrentUser());
    }),
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
    providePrimeNG({
      theme: {
        preset: definePreset(Aura, {
          semantic: {
            primary: {
              50: '{sky.50}',
              100: '{sky.100}',
              200: '{sky.200}',
              300: '{sky.300}',
              400: '{sky.400}',
              500: '{sky.500}',
              600: '{sky.600}',
              700: '{sky.700}',
              800: '{sky.800}',
              900: '{sky.900}',
              950: '{sky.950}',
            },
          },
        }),
        options: { darkModeSelector: '.app-dark' },
      },
    }),
    provideToastr({
      positionClass: 'toast-top-right',
      preventDuplicates: true,
    }),
    provideMarkdown(),
    provideTranslateService({
      loader: provideTranslateHttpLoader({
        prefix: '/i18n/',
        suffix: '.json',
      }),
      fallbackLang: 'en',
    }),
  ],
};
