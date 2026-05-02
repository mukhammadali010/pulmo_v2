import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export const SUPPORTED_LANGUAGES = ['uz', 'ru', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'app-language';
const DEFAULT_LANGUAGE: Language = 'uz';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly document = inject(DOCUMENT);

  private readonly _current = signal<Language>(this.resolveInitial());

  readonly current = this._current.asReadonly();
  readonly supported = SUPPORTED_LANGUAGES;

  constructor() {
    this.translate.addLangs([...SUPPORTED_LANGUAGES]);
    this.applyLanguage(this._current());
  }

  use(lang: Language): void {
    if (!SUPPORTED_LANGUAGES.includes(lang)) return;
    this._current.set(lang);
    this.applyLanguage(lang);
  }

  private applyLanguage(lang: Language): void {
    this.translate.use(lang);
    this.document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }

  private resolveInitial(): Language {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (this.isLanguage(stored)) return stored;
    } catch {
      // ignore
    }
    return DEFAULT_LANGUAGE;
  }

  private isLanguage(value: string | null): value is Language {
    return value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
  }
}
