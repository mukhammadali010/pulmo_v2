import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';

import { AuthService } from '@core/services/auth.service';
import { LanguageService, type Language } from '@core/services/language.service';
import { ThemeService } from '@core/services/theme.service';

interface NavItem {
  path: string;
  icon: string;
  labelKey: string;
  section: 'main' | 'clinical' | 'admin';
  adminOnly?: boolean;
}

@Component({
  selector: 'app-main-layout',
  imports: [
    DatePipe,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
    ButtonModule,
    SelectModule,
    FormsModule,
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly language = inject(LanguageService);

  protected readonly languageOptions = this.language.supported.map((code) => ({
    code,
    labelKey: `language.${code}`,
  }));

  protected readonly navItems: NavItem[] = [
    { path: '/dashboard', icon: 'pi-th-large', labelKey: 'nav.dashboard', section: 'main' },
    { path: '/patients', icon: 'pi-users', labelKey: 'nav.patients', section: 'clinical' },
    { path: '/examinations', icon: 'pi-microchip-ai', labelKey: 'nav.examinations', section: 'clinical' },
    { path: '/admin/doctors', icon: 'pi-id-card', labelKey: 'nav.doctors', section: 'admin', adminOnly: true },
  ];

  protected readonly isAdmin = computed(() => this.auth.user()?.role === 'admin');
  protected readonly mainNavItems = this.navItems.filter((item) => item.section === 'main');
  protected readonly clinicalNavItems = this.navItems.filter((item) => item.section === 'clinical');
  protected readonly adminNavItems = computed(() =>
    this.isAdmin() ? this.navItems.filter((item) => item.section === 'admin') : [],
  );

  protected readonly initials = computed(() => {
    const user = this.auth.user();
    if (!user?.fullName) return '?';
    return user.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });

  protected readonly greetingKey = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'dashboard.greetingMorning';
    if (hour < 18) return 'dashboard.greetingAfternoon';
    return 'dashboard.greetingEvening';
  });

  protected readonly today = new Date();

  protected readonly sidebarCollapsed = signal(this.readSidebarState());

  protected toggleSidebar(): void {
    const next = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(next);
    try {
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
    } catch {
      // ignore
    }
  }

  private readSidebarState(): boolean {
    try {
      return localStorage.getItem('sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  }

  protected toggleTheme(): void {
    this.theme.toggle();
  }

  protected onLanguageChange(lang: Language): void {
    this.language.use(lang);
  }

  protected logout(): void {
    this.auth.logout();
  }
}
