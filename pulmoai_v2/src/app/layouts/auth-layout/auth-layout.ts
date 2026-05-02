import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

interface BrandFeature {
  icon: string;
  key: string;
}

@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, TranslatePipe],
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.scss',
})
export class AuthLayout {
  protected readonly year = new Date().getFullYear();

  protected readonly features: BrandFeature[] = [
    { icon: 'pi-shield', key: 'auth.brand.features.secure' },
    { icon: 'pi-bolt', key: 'auth.brand.features.fast' },
    { icon: 'pi-chart-line', key: 'auth.brand.features.insights' },
  ];
}
