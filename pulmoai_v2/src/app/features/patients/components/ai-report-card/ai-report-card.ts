import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MarkdownComponent } from 'ngx-markdown';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

import type { Examination, Patient } from '@core/models';
import { ExaminationService } from '@core/services/examination.service';
import { LanguageService } from '@core/services/language.service';

@Component({
  selector: 'app-ai-report-card',
  imports: [DatePipe, TranslatePipe, MarkdownComponent, ButtonModule, DialogModule],
  templateUrl: './ai-report-card.html',
  styleUrl: './ai-report-card.scss',
})
export class AiReportCardComponent {
  private readonly toastr = inject(ToastrService);
  private readonly translate = inject(TranslateService);
  private readonly examinationService = inject(ExaminationService);
  private readonly language = inject(LanguageService);

  readonly examination = input.required<Examination>();
  readonly patient = input<Patient | null>(null);

  protected readonly dialogVisible = signal(false);
  protected readonly exporting = signal(false);
  protected readonly reanalyzing = signal(false);

  protected readonly hasReport = computed(
    () => !!this.examination().aiSummary || !!this.examination().aiReport,
  );

  protected readonly isFailed = computed(
    () => this.examination().status === 'failed' && !!this.examination().aiReport,
  );

  protected readonly canReanalyze = computed(
    () =>
      this.examination().status === 'done' &&
      (!!this.examination().aiSummary || !!this.examination().aiReport),
  );

  protected open(): void {
    this.dialogVisible.set(true);
  }

  protected reanalyze(): void {
    if (this.reanalyzing()) return;
    this.reanalyzing.set(true);
    this.examinationService
      .analyze(this.examination().id, this.language.current())
      .subscribe({
        next: () => {
          this.reanalyzing.set(false);
          this.toastr.success(this.translate.instant('examinations.saved'));
        },
        error: () => this.reanalyzing.set(false),
      });
  }

  protected async exportPdf(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas-pro')).default;

      const element = document.getElementById('ai-report-pdf-' + this.examination().id);
      if (!element) {
        this.toastr.error('Report element not found');
        return;
      }

      // Temporarily disable dark mode on the live document so the captured
      // pixels are dark-on-white (readable on printed paper). Restored in
      // the `finally` block so the user's theme preference is preserved.
      const html = document.documentElement;
      const wasDark = html.classList.contains('app-dark');
      if (wasDark) html.classList.remove('app-dark');

      let canvas: HTMLCanvasElement;
      try {
        canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
        });
      } finally {
        if (wasDark) html.classList.add('app-dark');
      }

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 20;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 10;
      const imgData = canvas.toDataURL('image/png');

      pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - 20;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight + 10;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
        heightLeft -= pageHeight - 20;
      }

      const filename = `pulmoai-report-${this.examination().id.slice(0, 8)}.pdf`;
      pdf.save(filename);
      this.toastr.success(this.translate.instant('examinations.pdfSaved'));
    } catch (e) {
      console.error(e);
      this.toastr.error('PDF export failed');
    } finally {
      this.exporting.set(false);
    }
  }
}
