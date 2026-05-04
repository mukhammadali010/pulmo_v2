import { Routes } from '@angular/router';

export const FINAL_DIAGNOSES_ROUTES: Routes = [
  {
    path: 'new',
    loadComponent: () =>
      import('./pages/final-diagnosis-create/final-diagnosis-create').then(
        (m) => m.FinalDiagnosisCreate,
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/final-diagnosis-detail/final-diagnosis-detail').then(
        (m) => m.FinalDiagnosisDetail,
      ),
  },
];
