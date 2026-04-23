import { Component, OnDestroy, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Subscription, catchError, filter, firstValueFrom, forkJoin, from, map, of, switchMap } from 'rxjs';
import { Storage } from '@ionic/storage-angular';
import { environment } from '../../environments/environment';

type BoughtStock = { symbol: string; quantity: number; avgBuyPrice: number };
type UserData = { user: string; balance: number; boughtStocks: BoughtStock[] };
type SimPosition = { qty: number; avgCost: number };
type SimTrade = { side: 'BUY' | 'SELL'; symbol: string; qty: number; price: number; total: number; at: string };
type StockView = BoughtStock & { currentPrice: number; cost: number; value: number; pnl: number; pnlPct: number };
type MarketItem = { symbol: string; price: number; weekPct: number };
type SectorSlice = { sector: string; value: number; pct: number };
type HistoryPoint = { label: string; value: number };
type HeatTile = { symbol: string; change: number; size: 'lg' | 'md' | 'sm' };
type NewsItem = { source: string; title: string; url?: string };
type RiskProfile = 'conservative' | 'balanced' | 'aggressive';

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
  private newsRefreshId: any;
  private navSub?: Subscription;
  private readonly portfolioRefreshMs = 10000;
  private readonly newsRefreshMs = 30000;
  navExpanded = false;
  private tradeLog: SimTrade[] = [];
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
  news: NewsItem[] = [];
  riskProfile: RiskProfile = 'balanced';
  targetPortfolio = 125000;
  goalProgressPct = 0;
  goalRemaining = 0;
  concentrationRiskPct = 0;
  diversificationScore = 0;
  portfolioHealthScore = 0;
  topHoldingSymbol = '—';
  coachMessage = 'Load market data to generate coach insights.';

  private readonly sectorMap: Record<string, string> = {
    AAPL: 'Technology',
    MSFT: 'Technology',
    NVDA: 'Technology',
    AMZN: 'Consumer',
    GOOGL: 'Communication',
    META: 'Communication',
    TSLA: 'Consumer',
    JPM: 'Financials',
    XOM: 'Energy',
    JNJ: 'Healthcare'
  };

  constructor(private http: HttpClient, private router: Router, @Inject(Storage) private storage: Storage) {}

  async ngOnInit(): Promise<void> {
    await this.storage.create();
    this.userName = ((await this.storage.get('settings.userName')) ?? '').toString();
    this.currency = ((await this.storage.get('settings.currency')) ?? 'USD').toString();
    this.defaultSymbol = (((await this.storage.get('settings.defaultSymbol')) ?? '^GSPC').toString().trim().toUpperCase()) || '^GSPC';
    await this.loadRuntimeSettings();

    this.tickClock();
    this.clockId = setInterval(() => this.tickClock(), 1000);
    await this.refreshDashboardData();
    this.startRealtimeFeeds();
    this.navSub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
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
    this.portfolioRefreshId = setInterval(() => this.loadUserData(true), this.portfolioRefreshMs);
    this.newsRefreshId = setInterval(() => this.loadNews(), this.newsRefreshMs);
  }

  private stopRealtimeFeeds(): void {
    clearInterval(this.portfolioRefreshId);
    clearInterval(this.newsRefreshId);
  }

  private async refreshDashboardData(): Promise<void> {
    await this.loadRuntimeSettings();
    this.loadNews();
    this.loadUserData();
  }

  private async loadRuntimeSettings(): Promise<void> {
    const rawRisk = ((await this.storage.get('settings.riskProfile')) ?? 'balanced').toString().trim().toLowerCase();
    this.riskProfile = rawRisk === 'conservative' || rawRisk === 'aggressive' ? rawRisk : 'balanced';

    const rawGoal = Number(await this.storage.get('settings.targetPortfolio'));
    if (Number.isFinite(rawGoal) && rawGoal >= 1000 && rawGoal <= 50000000) {
      this.targetPortfolio = rawGoal;
    } else {
      this.targetPortfolio = 125000;
    }
  }

  get portfolioNow(): number {
    return this.cashBalance + this.totalValue;
  }

  private tickClock(): void {
    const now = new Date();
    this.currentTime = now.toLocaleTimeString('en-US', { hour12: false });
    this.currentDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  }

  private loadUserData(isBackgroundRefresh = false): void {
    if (!isBackgroundRefresh) {
      this.loading = true;
      this.error = '';
    }

    from(this.getLiveUserData()).pipe(
      switchMap(userData => {
        const symbols = userData.boughtStocks.map(s => s.symbol.toUpperCase());

        if (!symbols.length) {
          return of({ userData, priceMap: new Map<string, number>() });
        }

        const requests = symbols.map(symbol => {
          const url = `${environment.apiBaseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
          return this.http.get<any>(url).pipe(
            map(response => {
              const result = response?.chart?.result?.[0];
              const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
              const lastClose = [...closes].reverse().find(v => v != null);
              const marketPrice = Number(result?.meta?.regularMarketPrice ?? lastClose ?? 0);
              return [symbol, marketPrice] as [string, number];
            }),
            catchError(() => of([symbol, 0] as [string, number]))
          );
        });

        return forkJoin(requests).pipe(map(rows => ({ userData, priceMap: new Map<string, number>(rows) })));
      }),
      map(({ userData, priceMap }) => {
        const views: StockView[] = userData.boughtStocks.map(holding => {
          const currentPrice = priceMap.get(holding.symbol.toUpperCase()) ?? 0;
          const cost = holding.quantity * holding.avgBuyPrice;
          const value = holding.quantity * currentPrice;
          const pnl = value - cost;
          const pnlPct = cost ? (pnl / cost) * 100 : 0;
          return { ...holding, currentPrice, cost, value, pnl, pnlPct };
        });

        const totalCost = views.reduce((sum, s) => sum + s.cost, 0);
        const totalValue = views.reduce((sum, s) => sum + s.value, 0);
        const totalPnl = totalValue - totalCost;
        const totalPnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;

        return { userData, views, totalCost, totalValue, totalPnl, totalPnlPct };
      })
    ).subscribe({
      next: data => {
        this.error = '';
        if (!this.userName) this.userName = data.userData.user;
        this.cashBalance = data.userData.balance;
        this.holdings = data.views;
        this.totalCost = data.totalCost;
        this.totalValue = data.totalValue;
        this.totalPnl = data.totalPnl;
        this.totalPnlPct = data.totalPnlPct;
        this.sectorAllocation = this.buildSectorAllocation();
        void this.refreshPortfolioHistory(data.userData);
        this.computeCoachInsights();
        if (!isBackgroundRefresh) {
          this.loadMarketPanels();
        }
        this.loading = false;
      },
      error: () => {
        if (!isBackgroundRefresh) {
          this.loading = false;
          this.error = 'Failed to load user data';
          this.topTicker = this.fallbackMarket();
          this.weeklyLeaders = this.fallbackMarket();
          this.computeCoachInsights();
        }
      }
    });
  }

  private async getLiveUserData(): Promise<UserData> {
    const fallbackFromAsset = async (): Promise<UserData> => {
      try {
        return await firstValueFrom(this.http.get<UserData>('assets/user-data.json'));
      } catch {
        // fall through to hard fallback
      }

      return {
        user: this.userName || 'INVESTOR',
        balance: 100000,
        boughtStocks: []
      };
    };

    const savedCash = await this.storage.get('simCash');
    const rawPositions = await this.storage.get('simPositions');
    const rawTrades = await this.storage.get('simTrades');

    const hasCash = typeof savedCash === 'number' && Number.isFinite(savedCash);
    const sourcePositions = (rawPositions && typeof rawPositions === 'object')
      ? (rawPositions as Record<string, unknown>)
      : {};

    const boughtStocks: BoughtStock[] = Object.entries(sourcePositions)
      .map(([symbol, value]) => {
        const row = (value && typeof value === 'object') ? (value as Partial<SimPosition>) : null;
        const quantity = Number(row?.qty ?? 0);
        const avgBuyPrice = Number(row?.avgCost ?? 0);
        return {
          symbol: symbol.toUpperCase(),
          quantity,
          avgBuyPrice
        };
      })
      .filter(s => Number.isFinite(s.quantity) && Number.isFinite(s.avgBuyPrice) && s.quantity > 0 && s.avgBuyPrice >= 0);

      this.tradeLog = Array.isArray(rawTrades)
        ? rawTrades
          .map(x => this.normalizeTrade(x))
          .filter((x): x is SimTrade => x !== null)
          .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
        : [];

    if (hasCash || boughtStocks.length > 0) {
      return {
        user: this.userName || 'INVESTOR',
        balance: hasCash ? Number(savedCash) : 100000,
        boughtStocks
      };
    }

    return fallbackFromAsset();
  }

  private normalizeTrade(raw: unknown): SimTrade | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const row = raw as Record<string, unknown>;
    const side = row['side'] === 'SELL' ? 'SELL' : row['side'] === 'BUY' ? 'BUY' : null;
    const symbol = String(row['symbol'] ?? '').trim().toUpperCase();
    const qty = Number(row['qty']);
    const price = Number(row['price']);
    const total = Number(row['total']);
    const at = String(row['at'] ?? '');

    if (!side || !symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(total) || total < 0 || !at) {
      return null;
    }

    return { side, symbol, qty, price, total, at };
  }

  private dayKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private formatDayLabel(date: Date, isToday: boolean): string {
    if (isToday) return 'TODAY';
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
  }

  private async fetchDailyCloseMaps(symbols: string[]): Promise<Map<string, Map<string, number>>> {
    const out = new Map<string, Map<string, number>>();

    await Promise.all(symbols.map(async symbol => {
      try {
        const url = `${environment.apiBaseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5y`;
        const response = await firstValueFrom(this.http.get<any>(url));
        const result = response?.chart?.result?.[0];
        const timestamps: number[] = result?.timestamp ?? [];
        const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];

        const mapByDay = new Map<string, number>();
        for (let i = 0; i < timestamps.length; i++) {
          const close = closes[i];
          if (close == null || !Number.isFinite(close)) continue;
          mapByDay.set(this.dayKey(new Date(timestamps[i] * 1000)), Number(close));
        }
        out.set(symbol, mapByDay);
      } catch {
        out.set(symbol, new Map<string, number>());
      }
    }));

    return out;
  }

  private async refreshPortfolioHistory(userData: UserData): Promise<void> {
    const now = new Date();
    const hourKey = `${this.dayKey(now)}-${now.getHours()}`;
    const fingerprint = `${this.cashBalance.toFixed(2)}|${this.totalValue.toFixed(2)}|${this.tradeLog.map(t => `${t.side}:${t.symbol}:${t.qty}:${t.total}:${t.at}`).join(';')}`;

    if (this.historyFingerprint === fingerprint && this.historyHourKey === hourKey && this.accountHistory.length) {
      return;
    }

    const trades = [...this.tradeLog].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    if (!trades.length) {
      this.accountHistory = [{ label: 'TODAY', value: this.portfolioNow }];
      this.historyFingerprint = fingerprint;
      this.historyHourKey = hourKey;
      return;
    }

    const firstAt = new Date(trades[0].at);
    const startDay = new Date(firstAt.getFullYear(), firstAt.getMonth(), firstAt.getDate());
    const endDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDayKey = this.dayKey(endDay);

    const symbols = Array.from(new Set([
      ...trades.map(t => t.symbol.toUpperCase()),
      ...userData.boughtStocks.map(h => h.symbol.toUpperCase())
    ]));
    const closeMaps = await this.fetchDailyCloseMaps(symbols);

    const buysMinusSells = trades.reduce((sum, t) => sum + (t.side === 'BUY' ? t.total : -t.total), 0);
    let cash = this.cashBalance + buysMinusSells;
    const positions = new Map<string, number>();
    const lastKnownClose = new Map<string, number>();
    const history: HistoryPoint[] = [];

    let ti = 0;
    for (let day = new Date(startDay); day <= endDay; day.setDate(day.getDate() + 1)) {
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime();
      while (ti < trades.length && new Date(trades[ti].at).getTime() <= dayEnd) {
        const t = trades[ti];
        const sym = t.symbol.toUpperCase();
        const currentQty = positions.get(sym) ?? 0;
        if (t.side === 'BUY') {
          positions.set(sym, currentQty + t.qty);
          cash -= t.total;
        } else {
          const nextQty = Math.max(0, currentQty - t.qty);
          if (nextQty <= 0) {
            positions.delete(sym);
          } else {
            positions.set(sym, nextQty);
          }
          cash += t.total;
        }
        ti++;
      }

      const key = this.dayKey(day);
      for (const sym of symbols) {
        const close = closeMaps.get(sym)?.get(key);
        if (close != null && Number.isFinite(close)) {
          lastKnownClose.set(sym, close);
        }
      }

      const isToday = key === endDayKey;
      let holdingsValue = 0;
      for (const [sym, qty] of positions.entries()) {
        holdingsValue += qty * (lastKnownClose.get(sym) ?? 0);
      }

      history.push({
        label: this.formatDayLabel(new Date(day), isToday),
        value: isToday ? this.portfolioNow : cash + holdingsValue
      });
    }

    this.accountHistory = history;
    this.historyFingerprint = fingerprint;
    this.historyHourKey = hourKey;
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

  private computeCoachInsights(): void {
    const holdingsValue = this.totalValue || 0;
    const sorted = [...this.holdings].sort((a, b) => b.value - a.value);
    const topHolding = sorted[0];
    this.topHoldingSymbol = topHolding?.symbol ?? '—';
    this.concentrationRiskPct = holdingsValue > 0 && topHolding ? (topHolding.value / holdingsValue) * 100 : 0;

    const sectors = this.sectorAllocation.filter(s => s.value > 0);
    const topSectorPct = sectors[0]?.pct ?? 100;
    this.diversificationScore = Math.max(0, Math.min(100, sectors.length * 18 + (100 - topSectorPct) * 0.45));

    this.goalProgressPct = this.targetPortfolio > 0 ? (this.portfolioNow / this.targetPortfolio) * 100 : 0;
    this.goalRemaining = Math.max(0, this.targetPortfolio - this.portfolioNow);

    const concentrationLimit = this.riskProfile === 'conservative' ? 35 : this.riskProfile === 'balanced' ? 50 : 65;
    const concentrationPenalty = Math.max(0, this.concentrationRiskPct - concentrationLimit) * 1.3;
    const pnlBoost = Math.max(-25, Math.min(25, this.totalPnlPct));
    const diversificationBoost = (this.diversificationScore - 50) * 0.35;
    const base = 68 + pnlBoost + diversificationBoost - concentrationPenalty;
    this.portfolioHealthScore = Math.max(0, Math.min(100, base));

    if (this.goalProgressPct >= 100) {
      this.coachMessage = 'Portfolio goal reached. Consider raising target or locking gains.';
      return;
    }

    if (this.concentrationRiskPct > concentrationLimit) {
      this.coachMessage = `Concentration risk is elevated in ${this.topHoldingSymbol}. Rebalance gradually.`;
      return;
    }

    if (this.totalPnlPct < 0) {
      this.coachMessage = 'Portfolio drawdown detected. Reduce order size and prioritize diversification.';
      return;
    }

    this.coachMessage = 'Allocation and momentum are aligned. Keep compounding with disciplined position sizing.';
  }

  private loadMarketPanels(): void {
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'MA', 'JNJ', 'XOM', 'CVX', 'WMT', 'PG', 'HD', 'KO', 'BAC', 'PFE', 'UNH', 'ORCL', 'NFLX', 'DIS'];
    const sizeMap = new Map<string, 'lg' | 'md' | 'sm'>([
      ['AAPL', 'lg'],
      ['MSFT', 'lg'],
      ['GOOGL', 'lg'],
      ['AMZN', 'lg'],
      ['NVDA', 'md'],
      ['META', 'md'],
      ['TSLA', 'md'],
      ['JPM', 'md']
    ]);

    const requests = symbols.map(symbol => {
      const url = `${environment.apiBaseUrl}/v8/finance/chart/${symbol}?interval=1d&range=5d`;
      return this.http.get<any>(url).pipe(
        map(response => {
          const result = response?.chart?.result?.[0];
          const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
          const valid = closes.filter(v => v != null) as number[];
          const first = valid[0] ?? 0;
          const last = Number(result?.meta?.regularMarketPrice ?? valid[valid.length - 1] ?? 0);
          const weekPct = first ? ((last - first) / first) * 100 : 0;
          return { symbol, price: last, weekPct } as MarketItem;
        }),
        catchError(() => of({ symbol, price: 0, weekPct: 0 } as MarketItem))
      );
    });

    forkJoin(requests).subscribe({
      next: rows => {
        const safe = rows.filter(r => r.price > 0);
        const useRows = safe.length ? safe : this.fallbackMarket();

        this.topTicker = useRows.slice(0, 5);
        this.weeklyLeaders = [...useRows].sort((a, b) => b.weekPct - a.weekPct).slice(0, 12);
        this.heatMapTiles = useRows.map(r => ({ symbol: r.symbol, change: r.weekPct, size: sizeMap.get(r.symbol) ?? 'sm' }));
      },
      error: () => {
        const fb = this.fallbackMarket();
        this.topTicker = fb.slice(0, 5);
        this.weeklyLeaders = fb;
        this.heatMapTiles = [
          { symbol: 'AAPL', change: -2.34, size: 'lg' },
          { symbol: 'MSFT', change: -1.91, size: 'lg' },
          { symbol: 'GOOGL', change: -1.66, size: 'lg' },
          { symbol: 'AMZN', change: -2.71, size: 'lg' },
          { symbol: 'NVDA', change: -3.45, size: 'md' },
          { symbol: 'META', change: -1.28, size: 'md' },
          { symbol: 'TSLA', change: -4.02, size: 'md' },
          { symbol: 'JPM', change: -0.88, size: 'md' }
        ];
      }
    });
  }

  private loadNews(): void {
    const url = `${environment.newsApiBaseUrl}/news?q=${encodeURIComponent('stock market OR equities OR federal reserve')}&language=en&pageSize=8`;
    this.http.get<any>(url).pipe(
      map(response => {
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        return rows
          .map((h: any) => ({
            source: String(h?.source || 'NEWS').toUpperCase(),
            title: String(h?.title || '').trim(),
            url: String(h?.url || '').trim() || undefined
          }))
          .filter((n: NewsItem) => !!n.title)
          .slice(0, 8);
      }),
      catchError(() => of<NewsItem[]>([]))
    ).subscribe(rows => {
      this.news = rows.length
        ? rows
        : [
            { source: 'BLOOMBERG', title: 'Markets mixed as investors digest latest macro data' },
            { source: 'REUTERS', title: 'Technology shares lead broader index movement' },
            { source: 'MARKET', title: 'Energy and financial sectors trade near weekly range' }
          ];
    });
  }

  private buildSectorAllocation(): SectorSlice[] {
    const bySector = new Map<string, number>();

    if (this.cashBalance > 0) {
      bySector.set('Cash', this.cashBalance);
    }

    for (const h of this.holdings) {
      const sector = this.sectorMap[h.symbol.toUpperCase()] ?? 'Other';
      bySector.set(sector, (bySector.get(sector) ?? 0) + h.value);
    }

    if (!bySector.size) {
      bySector.set('Cash', 0);
    }

    const total = Array.from(bySector.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(bySector.entries())
      .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
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
