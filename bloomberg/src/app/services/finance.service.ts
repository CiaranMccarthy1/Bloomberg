import { Injectable, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable, catchError, forkJoin, from, map, of, switchMap, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  BoughtStock, UserData, SimPosition, SimTrade, StockView,
  MarketItem, SectorSlice, HistoryPoint, HeatTile, RiskProfile,
  PriceAlert
} from '../models/finance.models';

@Injectable({
  providedIn: 'root'
})
export class FinanceService {
  private _storage: Storage | null = null;
  private readonly sectorMap: Record<string, string> = {
    AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology',
    AMZN: 'Consumer', GOOGL: 'Communication', META: 'Communication',
    TSLA: 'Consumer', JPM: 'Financials', XOM: 'Energy', JNJ: 'Healthcare'
  };

  private portfolioDataSubject = new BehaviorSubject<any>(null);
  portfolioData$ = this.portfolioDataSubject.asObservable();

  constructor(private http: HttpClient, @Inject(Storage) private storage: Storage) {
    this.init();
  }

  private async init() {
    this._storage = await this.storage.create();
  }

  private async getStorage(): Promise<Storage> {
    if (this._storage) return this._storage;
    this._storage = await this.storage.create();
    return this._storage;
  }

  async getStorageValue<T>(key: string, defaultValue: T): Promise<T> {
    const s = await this.getStorage();
    const val = await s.get(key);
    return val !== null && val !== undefined ? val : defaultValue;
  }

  async setStorageValue(key: string, value: any): Promise<void> {
    const s = await this.getStorage();
    await s.set(key, value);
  }

  getDashboardData(): Observable<any> {
    return from(this.getLiveUserData()).pipe(
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

        const dashboardData = {
          userData,
          views,
          totalCost,
          totalValue,
          totalPnl,
          totalPnlPct,
          cashBalance: userData.balance
        };
        this.portfolioDataSubject.next(dashboardData);
        return dashboardData;
      })
    );
  }

  async getLiveUserData(): Promise<UserData> {
    const s = await this.getStorage();
    const userName = await s.get('settings.userName') || 'INVESTOR';
    const savedCash = await s.get('simCash');
    const rawPositions = await s.get('simPositions');
    
    const hasCash = typeof savedCash === 'number' && Number.isFinite(savedCash);
    const sourcePositions = (rawPositions && typeof rawPositions === 'object') ? (rawPositions as Record<string, any>) : {};

    const boughtStocks: BoughtStock[] = Object.entries(sourcePositions)
      .map(([symbol, value]) => ({
        symbol: symbol.toUpperCase(),
        quantity: Number(value?.qty ?? 0),
        avgBuyPrice: Number(value?.avgCost ?? 0)
      }))
      .filter(s => s.quantity > 0);

    if (hasCash || boughtStocks.length > 0) {
      return {
        user: userName,
        balance: hasCash ? Number(savedCash) : 100000,
        boughtStocks
      };
    }

    try {
      return await firstValueFrom(this.http.get<UserData>('assets/user-data.json'));
    } catch {
      return { user: userName, balance: 100000, boughtStocks: [] };
    }
  }

  calculateCoachInsights(data: any, riskProfile: RiskProfile, targetPortfolio: number) {
    const holdingsValue = data.totalValue || 0;
    const portfolioNow = data.cashBalance + data.totalValue;
    const sorted = [...data.views].sort((a, b) => b.value - a.value);
    const topHolding = sorted[0];
    const concentrationRiskPct = holdingsValue > 0 && topHolding ? (topHolding.value / holdingsValue) * 100 : 0;

    const sectorAllocation = this.buildSectorAllocation(data.views, data.cashBalance);
    const sectors = sectorAllocation.filter(s => s.value > 0);
    const topSectorPct = sectors[0]?.pct ?? 100;
    const diversificationScore = Math.max(0, Math.min(100, sectors.length * 18 + (100 - topSectorPct) * 0.45));

    const goalProgressPct = targetPortfolio > 0 ? (portfolioNow / targetPortfolio) * 100 : 0;
    const goalRemaining = Math.max(0, targetPortfolio - portfolioNow);

    const concentrationLimit = riskProfile === 'conservative' ? 35 : riskProfile === 'balanced' ? 50 : 65;
    const concentrationPenalty = Math.max(0, concentrationRiskPct - concentrationLimit) * 1.3;
    const pnlBoost = Math.max(-25, Math.min(25, data.totalPnlPct));
    const diversificationBoost = (diversificationScore - 50) * 0.35;
    const base = 68 + pnlBoost + diversificationBoost - concentrationPenalty;
    const portfolioHealthScore = Math.max(0, Math.min(100, base));

    let coachMessage = 'Allocation and momentum are aligned. Keep compounding with disciplined position sizing.';
    if (goalProgressPct >= 100) {
      coachMessage = 'Portfolio goal reached. Consider raising target or locking gains.';
    } else if (concentrationRiskPct > concentrationLimit) {
      coachMessage = `Concentration risk is elevated in ${topHolding?.symbol ?? '—'}. Rebalance gradually.`;
    } else if (data.totalPnlPct < 0) {
      coachMessage = 'Portfolio drawdown detected. Reduce order size and prioritize diversification.';
    }

    return {
      concentrationRiskPct,
      diversificationScore,
      portfolioHealthScore,
      goalProgressPct,
      goalRemaining,
      coachMessage,
      topHoldingSymbol: topHolding?.symbol ?? '—',
      sectorAllocation
    };
  }

  buildSectorAllocation(holdings: StockView[], cashBalance: number): SectorSlice[] {
    const bySector = new Map<string, number>();
    if (cashBalance > 0) bySector.set('Cash', cashBalance);
    for (const h of holdings) {
      const sector = this.sectorMap[h.symbol.toUpperCase()] ?? 'Other';
      bySector.set(sector, (bySector.get(sector) ?? 0) + h.value);
    }
    if (!bySector.size) bySector.set('Cash', 0);
    const total = Array.from(bySector.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(bySector.entries())
      .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
  }

  getMarketPanels(): Observable<any> {
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'MA', 'JNJ', 'XOM', 'CVX', 'WMT', 'PG', 'HD', 'KO', 'BAC', 'PFE', 'UNH', 'ORCL', 'NFLX', 'DIS'];
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

    return forkJoin(requests);
  }

  async getPortfolioHistory(userData: UserData, cashBalance: number, totalValue: number, tradeLog: SimTrade[]): Promise<HistoryPoint[]> {
    const now = new Date();
    const trades = [...tradeLog].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    if (!trades.length) return [{ label: 'TODAY', value: cashBalance + totalValue }];

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
    let cash = cashBalance + buysMinusSells;
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
          positions.set(sym, Math.max(0, currentQty - t.qty));
          cash += t.total;
        }
        ti++;
      }

      const key = this.dayKey(day);
      for (const sym of symbols) {
        const close = closeMaps.get(sym)?.get(key);
        if (close != null) lastKnownClose.set(sym, close);
      }

      let holdingsValue = 0;
      for (const [sym, qty] of positions.entries()) {
        holdingsValue += qty * (lastKnownClose.get(sym) ?? 0);
      }

      history.push({
        label: this.formatDayLabel(new Date(day), key === endDayKey),
        value: key === endDayKey ? cashBalance + totalValue : cash + holdingsValue
      });
    }
    return history;
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
          if (close != null) mapByDay.set(this.dayKey(new Date(timestamps[i] * 1000)), Number(close));
        }
        out.set(symbol, mapByDay);
      } catch {
        out.set(symbol, new Map<string, number>());
      }
    }));
    return out;
  }

  private dayKey(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private formatDayLabel(date: Date, isToday: boolean): string {
    if (isToday) return 'TODAY';
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
  }
  async buyAtMarket(symbol: string, qty: number, currentPrice: number): Promise<string> {
    const s = await this.getStorage();
    const cash = await s.get('simCash') ?? 100000;
    const total = qty * currentPrice;
    if (total > cash) return 'Insufficient cash';

    const positions = await s.get('simPositions') ?? {};
    const existing = positions[symbol] ?? { qty: 0, avgCost: 0 };
    const nextQty = existing.qty + qty;
    const nextAvg = ((existing.qty * existing.avgCost) + total) / nextQty;

    positions[symbol] = { qty: nextQty, avgCost: nextAvg };
    await s.set('simCash', cash - total);
    await s.set('simPositions', positions);

    const trades = await s.get('simTrades') ?? [];
    trades.unshift({ side: 'BUY', symbol, qty, price: currentPrice, total, at: new Date().toISOString() });
    await s.set('simTrades', trades.slice(0, 50));

    return `Bought ${qty} ${symbol} @ ${currentPrice.toFixed(2)}`;
  }

  async sellAtMarket(symbol: string, qty: number, currentPrice: number): Promise<string> {
    const s = await this.getStorage();
    const positions = await s.get('simPositions') ?? {};
    const existing = positions[symbol] ?? { qty: 0, avgCost: 0 };
    if (existing.qty < qty) return 'Not enough shares';

    const total = qty * currentPrice;
    const nextQty = existing.qty - qty;
    if (nextQty <= 0) delete positions[symbol];
    else positions[symbol] = { qty: nextQty, avgCost: existing.avgCost };

    const cash = await s.get('simCash') ?? 100000;
    await s.set('simCash', cash + total);
    await s.set('simPositions', positions);

    const trades = await s.get('simTrades') ?? [];
    trades.unshift({ side: 'SELL', symbol, qty, price: currentPrice, total, at: new Date().toISOString() });
    await s.set('simTrades', trades.slice(0, 50));

    return `Sold ${qty} ${symbol} @ ${currentPrice.toFixed(2)}`;
  }

  async getPriceAlerts(): Promise<PriceAlert[]> {
    const s = await this.getStorage();
    const raw = await s.get('priceAlerts');
    return Array.isArray(raw) ? raw : [];
  }

  async savePriceAlerts(alerts: PriceAlert[]): Promise<void> {
    const s = await this.getStorage();
    await s.set('priceAlerts', alerts.slice(0, 50));
  }
}
