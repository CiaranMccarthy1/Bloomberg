import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Subscription, catchError, filter, forkJoin, map, of, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';

type BoughtStock = { symbol: string; quantity: number; avgBuyPrice: number };
type UserData = { user: string; balance: number; boughtStocks: BoughtStock[] };
type StockView = BoughtStock & { currentPrice: number; cost: number; value: number; pnl: number; pnlPct: number };
type MarketItem = { symbol: string; price: number; weekPct: number };
type SectorSlice = { sector: string; value: number; pct: number };
type HistoryPoint = { label: string; value: number };
type HeatTile = { symbol: string; change: number; size: 'lg' | 'md' | 'sm' };
type NewsItem = { source: string; title: string };

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
  private navSub?: Subscription;
  navExpanded = false;

  userName = '';
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

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit(): void {
    this.tickClock();
    this.clockId = setInterval(() => this.tickClock(), 1000);
    this.refreshDashboardData();
    this.navSub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      const ev = e as NavigationEnd;
      if (ev.urlAfterRedirects === '/') {
        this.refreshDashboardData();
      }
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.clockId);
    this.navSub?.unsubscribe();
  }

  private refreshDashboardData(): void {
    this.loadNews();
    this.loadUserData();
  }

  get portfolioNow(): number {
    return this.cashBalance + this.totalValue;
  }

  private tickClock(): void {
    const now = new Date();
    this.currentTime = now.toLocaleTimeString('en-US', { hour12: false });
    this.currentDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  }

  private loadUserData(): void {
    this.loading = true;
    this.error = '';

    this.http.get<UserData>('assets/user-data.json').pipe(
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
        this.userName = data.userData.user;
        this.cashBalance = data.userData.balance;
        this.holdings = data.views;
        this.totalCost = data.totalCost;
        this.totalValue = data.totalValue;
        this.totalPnl = data.totalPnl;
        this.totalPnlPct = data.totalPnlPct;
        this.sectorAllocation = this.buildSectorAllocation();
        this.accountHistory = this.buildHistory();
        this.loadMarketPanels();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Failed to load user data';
        this.topTicker = this.fallbackMarket();
        this.weeklyLeaders = this.fallbackMarket();
      }
    });
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
    const url = 'https://hn.algolia.com/api/v1/search?query=stock%20market&tags=story';
    this.http.get<any>(url).pipe(
      map(response => {
        const hits = response?.hits ?? [];
        return hits
          .map((h: any) => ({
            source: String(h?.author || 'NEWS').toUpperCase(),
            title: String(h?.title || h?.story_title || '').trim()
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
    if (!this.holdings.length) {
      return [
        { sector: 'Cash', value: this.cashBalance, pct: 100 }
      ];
    }

    const bySector = new Map<string, number>();
    for (const h of this.holdings) {
      const sector = this.sectorMap[h.symbol.toUpperCase()] ?? 'Other';
      bySector.set(sector, (bySector.get(sector) ?? 0) + h.value);
    }

    const total = Array.from(bySector.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(bySector.entries())
      .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
  }

  private buildHistory(): HistoryPoint[] {
    const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const nowValue = this.portfolioNow || this.cashBalance || 100000;
    const drift = this.totalPnl / 8;
    return labels.map((label, i) => {
      const wave = Math.sin(i * 0.8) * 180;
      const value = nowValue - (6 - i) * drift + wave;
      return { label, value };
    });
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

  openMarket(symbol: string): void {
    this.router.navigate(['/market'], { queryParams: { symbol } });
  }

  toggleSideTab(): void {
    this.navExpanded = !this.navExpanded;
  }

  goTrading(): void {
    this.navExpanded = false;
    this.router.navigate(['/market']);
  }

  goHome(): void {
    this.navExpanded = false;
    if (this.router.url === '/') {
      this.refreshDashboardData();
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
