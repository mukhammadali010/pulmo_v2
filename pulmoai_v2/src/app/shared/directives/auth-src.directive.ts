import { HttpClient } from '@angular/common/http';
import { Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Loads an `<img>` or `<audio>` / `<video>` source through HttpClient (so the
 * auth interceptor attaches the bearer token), then exposes the result as a
 * blob: URL. Required because raw `src` attributes use browser fetches that
 * bypass our interceptors.
 *
 * Usage:
 *   <img [appAuthSrc]="exam.attachmentUrl" alt="" />
 *   <audio controls [appAuthSrc]="exam.attachmentUrl"></audio>
 */
@Directive({
  selector: 'img[appAuthSrc], audio[appAuthSrc], video[appAuthSrc]',
})
export class AuthSrcDirective {
  private readonly elem = inject<ElementRef<HTMLImageElement | HTMLMediaElement>>(ElementRef);
  private readonly http = inject(HttpClient);

  readonly appAuthSrc = input<string | null | undefined>(null);

  constructor() {
    effect((onCleanup) => {
      const src = this.appAuthSrc();
      const node = this.elem.nativeElement;

      if (!src) {
        node.removeAttribute('src');
        return;
      }

      let objectUrl: string | null = null;
      const sub = this.http.get(src, { responseType: 'blob' }).subscribe({
        next: (blob) => {
          objectUrl = URL.createObjectURL(blob);
          node.src = objectUrl;
        },
      });

      onCleanup(() => {
        sub.unsubscribe();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      });
    });
  }
}
