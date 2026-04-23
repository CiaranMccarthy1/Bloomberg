import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { FinanceService } from '../services/finance.service';
import { RiskProfile } from '../models/finance.models';

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

  constructor(private router: Router, private financeService: FinanceService) {}

  async ngOnInit(): Promise<void> {
    const userData = await this.financeService.getLiveUserData();

    this.userName = await this.financeService.getStorageValue('settings.userName', userData?.user || 'INVESTOR');
    this.defaultSymbol = await this.financeService.getStorageValue('settings.defaultSymbol', await this.financeService.getStorageValue('symbol', '^GSPC'));
    this.currency = await this.financeService.getStorageValue('settings.currency', 'USD');
    this.theme = await this.financeService.getStorageValue('settings.theme', 'sleek-dark');
    this.fontSize = await this.financeService.getStorageValue('settings.fontSize', 'medium');
    this.riskProfile = await this.financeService.getStorageValue('settings.riskProfile', 'balanced') as RiskProfile;
    this.targetPortfolio = Number(await this.financeService.getStorageValue('settings.targetPortfolio', 125000));
    this.autoRefreshSec = Number(await this.financeService.getStorageValue('settings.autoRefreshSec', 180));
    
    const sWatchlist = await this.financeService.getStorageValue('watchlist', []);
    if (Array.isArray(sWatchlist) && sWatchlist.length) {
      this.watchlistSeed = sWatchlist.join(', ');
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
    this.targetPortfolio = cleanTarget;
    this.autoRefreshSec = cleanRefresh;
    this.watchlistSeed = parsedWatchlist.join(', ');

    await this.financeService.setStorageValue('settings.userName', this.userName);
    await this.financeService.setStorageValue('settings.defaultSymbol', cleanSymbol);
    await this.financeService.setStorageValue('settings.currency', this.currency);
    await this.financeService.setStorageValue('settings.theme', this.theme);
    await this.financeService.setStorageValue('settings.fontSize', this.fontSize);
    await this.financeService.setStorageValue('settings.riskProfile', this.riskProfile);
    await this.financeService.setStorageValue('settings.targetPortfolio', cleanTarget);
    await this.financeService.setStorageValue('settings.autoRefreshSec', cleanRefresh);
    await this.financeService.setStorageValue('symbol', cleanSymbol);
    await this.financeService.setStorageValue('watchlist', parsedWatchlist);

    this.applyDisplaySettings();
    this.status = 'Settings saved. Trading intelligence and dashboard coach updated.';
  }

  onDisplaySettingsChange(): void {
    this.applyDisplaySettings();
    this.status = 'Preview applied (save to persist)';
  }

  async resetPortfolio(): Promise<void> {
    await this.financeService.setStorageValue('simCash', 100000);
    await this.financeService.setStorageValue('simPositions', {});
    await this.financeService.setStorageValue('simTrades', []);
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
      simCash: await this.financeService.getStorageValue('simCash', 100000),
      simPositions: await this.financeService.getStorageValue('simPositions', {}),
      simTrades: await this.financeService.getStorageValue('simTrades', []),
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
}
