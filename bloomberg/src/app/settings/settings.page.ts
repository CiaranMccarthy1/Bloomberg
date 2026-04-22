import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { IonContent } from '@ionic/angular/standalone';
import { Storage } from '@ionic/storage-angular';
import { firstValueFrom } from 'rxjs';

type UserData = { user: string; balance: number; boughtStocks: Array<{ symbol: string; quantity: number; avgBuyPrice: number }> };
type RiskProfile = 'conservative' | 'balanced' | 'aggressive';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent],
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss']
})
export class SettingsPage implements OnInit {
  navExpanded = false;
  currentTime = '';
  currentDate = '';
  private clockId: any;

  userName = '';
  defaultSymbol = '^GSPC';
  currency = 'USD';
  theme = 'sleek-dark';
  fontSize = 'medium';
  riskProfile: RiskProfile = 'balanced';
  targetPortfolio = 125000;
  autoRefreshSec = 180;
  watchlistSeed = '^GSPC, AAPL, MSFT, NVDA';
  status = '';

  constructor(private router: Router, private http: HttpClient, @Inject(Storage) private storage: Storage) {}

  async ngOnInit(): Promise<void> {
    await this.storage.create();
    const userData = await firstValueFrom(this.http.get<UserData>('assets/user-data.json'));

    const sUserName = await this.storage.get('settings.userName');
    const sDefaultSymbol = await this.storage.get('settings.defaultSymbol');
    const sCurrency = await this.storage.get('settings.currency');
    const sTheme = await this.storage.get('settings.theme');
    const sFontSize = await this.storage.get('settings.fontSize');
    const sRiskProfile = await this.storage.get('settings.riskProfile');
    const sTargetPortfolio = await this.storage.get('settings.targetPortfolio');
    const sAutoRefreshSec = await this.storage.get('settings.autoRefreshSec');
    const sWatchlist = await this.storage.get('watchlist');

    this.userName = (sUserName ?? userData?.user ?? '').toString();
    this.defaultSymbol = (sDefaultSymbol ?? (await this.storage.get('symbol')) ?? '^GSPC').toString();
    this.currency = (sCurrency ?? 'USD').toString();
    this.theme = (sTheme ?? 'sleek-dark').toString();
    this.fontSize = (sFontSize ?? 'medium').toString();
    this.riskProfile = this.parseRiskProfile((sRiskProfile ?? 'balanced').toString());

    const target = Number(sTargetPortfolio);
    this.targetPortfolio = Number.isFinite(target) && target >= 1000 ? target : 125000;

    const refresh = Number(sAutoRefreshSec);
    this.autoRefreshSec = Number.isFinite(refresh) && refresh >= 30 && refresh <= 600 ? Math.round(refresh) : 180;

    if (Array.isArray(sWatchlist) && sWatchlist.length) {
      const normalized = sWatchlist.map((s: unknown) => String(s || '').trim().toUpperCase()).filter(Boolean);
      if (normalized.length) this.watchlistSeed = normalized.join(', ');
    }

    this.applyDisplaySettings();
    this.tickClock();
    this.clockId = setInterval(() => this.tickClock(), 1000);
  }

  ngOnDestroy(): void {
    clearInterval(this.clockId);
  }

  private tickClock(): void {
    const now = new Date();
    this.currentTime = now.toLocaleTimeString('en-US', { hour12: false });
    this.currentDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  }

  toggleSideTab(): void {
    this.navExpanded = !this.navExpanded;
  }

  goHome(): void {
    this.navExpanded = false;
    this.router.navigate(['/']);
  }

  goTrading(): void {
    this.navExpanded = false;
    this.router.navigate(['/market'], { queryParams: { symbol: this.defaultSymbol.trim().toUpperCase() || '^GSPC' } });
  }

  goSettings(): void {
    this.navExpanded = false;
    this.router.navigate(['/settings']);
  }

  async saveSettings(): Promise<void> {
    const cleanSymbol = this.defaultSymbol.trim().toUpperCase() || '^GSPC';
    const cleanRisk = this.parseRiskProfile(this.riskProfile);
    const cleanTarget = Math.min(50000000, Math.max(1000, Math.round(Number(this.targetPortfolio) || 125000)));
    const cleanRefresh = Math.min(600, Math.max(30, Math.round(Number(this.autoRefreshSec) || 180)));
    const parsedWatchlist = Array.from(new Set(
      this.watchlistSeed
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean)
    )).slice(0, 12);

    if (!parsedWatchlist.length) parsedWatchlist.push(cleanSymbol);

    this.defaultSymbol = cleanSymbol;
    this.riskProfile = cleanRisk;
    this.targetPortfolio = cleanTarget;
    this.autoRefreshSec = cleanRefresh;
    this.watchlistSeed = parsedWatchlist.join(', ');

    await this.storage.set('settings.userName', this.userName);
    await this.storage.set('settings.defaultSymbol', cleanSymbol);
    await this.storage.set('settings.currency', this.currency);
    await this.storage.set('settings.theme', this.theme);
    await this.storage.set('settings.fontSize', this.fontSize);
    await this.storage.set('settings.riskProfile', cleanRisk);
    await this.storage.set('settings.targetPortfolio', cleanTarget);
    await this.storage.set('settings.autoRefreshSec', cleanRefresh);
    await this.storage.set('symbol', cleanSymbol);
    await this.storage.set('watchlist', parsedWatchlist);

    this.applyDisplaySettings();
    this.status = 'Settings saved. Trading intelligence and dashboard coach updated.';
  }

  async resetPortfolio(): Promise<void> {
    await this.storage.set('simCash', 100000);
    await this.storage.set('simPositions', {});
    await this.storage.set('simTrades', []);
    this.status = 'Cash reset to 100,000 and owned stocks cleared';
  }

  async exportProfile(): Promise<void> {
    const payload = {
      userName: this.userName,
      defaultSymbol: this.defaultSymbol,
      currency: this.currency,
      theme: this.theme,
      fontSize: this.fontSize,
      riskProfile: this.riskProfile,
      targetPortfolio: this.targetPortfolio,
      autoRefreshSec: this.autoRefreshSec,
      watchlist: this.watchlistSeed.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      simCash: (await this.storage.get('simCash')) ?? 100000,
      simPositions: (await this.storage.get('simPositions')) ?? {},
      simTrades: (await this.storage.get('simTrades')) ?? [],
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `profile-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.status = 'Profile exported to JSON';
  }

  private applyDisplaySettings(): void {
    document.body.setAttribute('data-theme', this.theme);
    document.body.setAttribute('data-font-size', this.fontSize);
  }

  private parseRiskProfile(value: string): RiskProfile {
    const v = value.trim().toLowerCase();
    if (v === 'conservative' || v === 'aggressive') return v;
    return 'balanced';
  }
}
