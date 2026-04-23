import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Subscription, filter } from 'rxjs';
import { FinanceService } from '../services/finance.service';
import { StockView, MarketItem, SectorSlice, HistoryPoint, HeatTile, RiskProfile, UserData } from '../models/finance.models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, IonContent],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss']
})
export class DashboardPage implements OnInit, OnDestroy {
  currentTime = '';
  currentDate = '';
  private clockId: any;
  private portfolioRefreshId: any;
  private navSub?: Subscription;
  private readonly portfolioRefreshMs = 10000;
  navExpanded = false;
  private historyFingerprint = '';
  private historyHourKey = '';

  userName = '';
  currency = 'USD';
  defaultSymbol = '^GSPC';
  cashBalance = 0;
  holdings: StockView[] = [];
  totalCost = 0;
  totalValue = 0;
  totalPnl = 0;
  totalPnlPct = 0;
  loading = true;
  error = '';

  topTicker: MarketItem[] = [];
  weeklyLeaders: MarketItem[] = [];
  sectorAllocation: SectorSlice[] = [];
  accountHistory: HistoryPoint[] = [];
  heatMapTiles: HeatTile[] = [];
  riskProfile: RiskProfile = 'balanced';
  targetPortfolio = 125000;
  goalProgressPct = 0;
  goalRemaining = 0;
  concentrationRiskPct = 0;
  diversificationScore = 0;
  portfolioHealthScore = 0;
  topHoldingSymbol = '—';
  coachMessage = 'Load market data to generate coach insights.';

  constructor(private financeService: FinanceService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    await this.loadInitialSettings();
    this.tickClock();
    this.clockId = setInterval(() => this.tickClock(), 1000);
    
    await this.refreshDashboardData();
    this.startRealtimeFeeds();

    this.navSub = this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe(e => {
      const ev = e as NavigationEnd;
      if (ev.urlAfterRedirects === '/') {
        void this.refreshDashboardData();
      }
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.clockId);
    this.stopRealtimeFeeds();
    this.navSub?.unsubscribe();
  }

  private startRealtimeFeeds(): void {
    this.stopRealtimeFeeds();
    this.portfolioRefreshId = setInterval(() => this.loadData(true), this.portfolioRefreshMs);
  }

  private stopRealtimeFeeds(): void {
    clearInterval(this.portfolioRefreshId);
  }

  private async loadInitialSettings(): Promise<void> {
    this.userName = await this.financeService.getStorageValue('settings.userName', '');
    this.currency = await this.financeService.getStorageValue('settings.currency', 'USD');
    this.defaultSymbol = (await this.financeService.getStorageValue('settings.defaultSymbol', '^GSPC')).trim().toUpperCase() || '^GSPC';
    this.riskProfile = await this.financeService.getStorageValue('settings.riskProfile', 'balanced') as RiskProfile;
    this.targetPortfolio = Number(await this.financeService.getStorageValue('settings.targetPortfolio', 125000));
  }

  private async refreshDashboardData(): Promise<void> {
    await this.loadInitialSettings();
    this.loadData();
  }

  private loadData(isBackground = false): void {
    if (!isBackground) {
      this.loading = true;
      this.error = '';
    }

    this.financeService.getDashboardData().subscribe({
      next: data => {
        this.error = '';
        this.cashBalance = data.cashBalance;
        this.holdings = data.views;
        this.totalCost = data.totalCost;
        this.totalValue = data.totalValue;
        this.totalPnl = data.totalPnl;
        this.totalPnlPct = data.totalPnlPct;

        const insights = this.financeService.calculateCoachInsights(data, this.riskProfile, this.targetPortfolio);
        this.concentrationRiskPct = insights.concentrationRiskPct;
        this.diversificationScore = insights.diversificationScore;
        this.portfolioHealthScore = insights.portfolioHealthScore;
        this.goalProgressPct = insights.goalProgressPct;
        this.goalRemaining = insights.goalRemaining;
        this.coachMessage = insights.coachMessage;
        this.topHoldingSymbol = insights.topHoldingSymbol;
        this.sectorAllocation = insights.sectorAllocation;

        void this.updateHistory(data.userData);
        if (!isBackground) this.loadMarketData();
        this.loading = false;
      },
      error: () => {
        if (!isBackground) {
          this.loading = false;
          this.error = 'Failed to load user data';
          this.topTicker = this.fallbackMarket();
          this.weeklyLeaders = this.fallbackMarket();
        }
      }
    });
  }

  private async updateHistory(userData: UserData): Promise<void> {
    const tradeLog = await this.financeService.getStorageValue('simTrades', []);
    this.accountHistory = await this.financeService.getPortfolioHistory(userData, this.cashBalance, this.totalValue, tradeLog);
  }

  private loadMarketData(): void {
    const sizeMap: Record<string, 'lg' | 'md' | 'sm'> = {
      AAPL: 'lg', MSFT: 'lg', GOOGL: 'lg', AMZN: 'lg',
      NVDA: 'md', META: 'md', TSLA: 'md', JPM: 'md'
    };

    this.financeService.getMarketPanels().subscribe({
      next: rows => {
        const safe = rows.filter((r: MarketItem) => r.price > 0);
        const useRows = safe.length ? safe : this.fallbackMarket();
        this.topTicker = useRows.slice(0, 5);
        this.weeklyLeaders = [...useRows].sort((a, b) => b.weekPct - a.weekPct).slice(0, 12);
        this.heatMapTiles = useRows.map((r: MarketItem) => ({ symbol: r.symbol, change: r.weekPct, size: sizeMap[r.symbol] ?? 'sm' }));
      }
    });
  }

  private tickClock(): void {
    const now = new Date();
    this.currentTime = now.toLocaleTimeString('en-US', { hour12: false });
    this.currentDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  }

  get portfolioNow(): number {
    return this.cashBalance + this.totalValue;
  }

  get goalProgressBarPct(): number {
    return Math.max(0, Math.min(100, this.goalProgressPct));
  }

  get riskProfileLabel(): string {
    return this.riskProfile.toUpperCase();
  }

  healthClass(): string {
    if (this.portfolioHealthScore >= 75) return 'good';
    if (this.portfolioHealthScore >= 50) return 'warn';
    return 'risk';
  }

  private fallbackMarket(): MarketItem[] {
    return [
      { symbol: 'AAPL', price: 213.4, weekPct: 1.12 },
      { symbol: 'MSFT', price: 427.2, weekPct: 0.84 },
      { symbol: 'NVDA', price: 921.3, weekPct: 2.41 },
      { symbol: 'AMZN', price: 189.7, weekPct: 0.65 },
      { symbol: 'GOOGL', price: 170.6, weekPct: 1.03 }
    ];
  }

  fmt(n: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  money(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  }

  openMarket(symbol: string): void {
    this.router.navigate(['/market'], { queryParams: { symbol } });
  }

  toggleSideTab(): void {
    this.navExpanded = !this.navExpanded;
  }

  goTrading(): void {
    this.navExpanded = false;
    this.router.navigate(['/market'], { queryParams: { symbol: this.defaultSymbol } });
  }

  goSettings(): void {
    this.navExpanded = false;
    this.router.navigate(['/settings']);
  }

  goHome(): void {
    this.navExpanded = false;
    if (this.router.url === '/') {
      void this.refreshDashboardData();
      return;
    }
    this.router.navigate(['/']);
  }

  tileTone(change: number): string {
    if (change <= -4) return 'deep-red';
    if (change < -1) return 'mid-red';
    if (change < 1) return 'flat';
    if (change < 4) return 'mid-green';
    return 'deep-green';
  }
}