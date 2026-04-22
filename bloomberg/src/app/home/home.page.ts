import { Component, OnInit, OnDestroy, ElementRef, ViewChild, NgZone, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Chart, registerables, TooltipItem } from 'chart.js';
import { Observable, Subscription, map, take } from 'rxjs';
import { Storage } from '@ionic/storage-angular';
import { environment } from '../../environments/environment';

Chart.register(...registerables);

type TickerOption = { symbol: string; name: string };
type SimPosition = { qty: number; avgCost: number };
type SimTrade = { side: 'BUY' | 'SELL'; symbol: string; qty: number; price: number; total: number; at: string };
type PriceAlertDirection = 'above' | 'below';
type PriceAlert = { id: string; symbol: string; direction: PriceAlertDirection; target: number; createdAt: string; triggeredAt?: string };

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonContent],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss']
})
export class HomePage implements OnInit, OnDestroy {
  @ViewChild('chartCanvas', { static: true }) chartCanvas!: ElementRef<HTMLCanvasElement>;

  currentTime = '';
  currentDate = '';
  price = '—';
  change = '—';
  changeClass = '';
  statOpen = '—';
  statHigh = '—';
  statLow = '—';
  statPrev = '—';
  stat52h = '—';
  stat52l = '—';
  loading = true;
  loadingMsg = 'LOADING MARKET DATA...';
  navExpanded = false;
  currentPriceNum = 0;

  simCash = 100000;
  currency = 'USD';
  defaultSymbol = '^GSPC';
  tradeQtyInput = 1;
  tradeMessage = '';
  currentPositionQty = 0;
  currentPositionAvg = 0;
  currentPositionValue = 0;
  currentPositionUnrealized = 0;
  recentTrades: SimTrade[] = [];
  watchlist: string[] = [];
  trendSignal = 'RANGE-BOUND';
  trendConfidence = 0;
  trendReturnPct = 0;
  volatilityPct = 0;
  autoRefreshSec = 180;
  alertTargetInput: number | null = null;
  alertDirectionInput: PriceAlertDirection = 'above';
  alertStatus = '';
  priceAlerts: PriceAlert[] = [];

  symbol = '^GSPC';
  symbolInput = '^GSPC';
  suggestions: TickerOption[] = [];
  showSuggestions = false;
  private readonly tickerOptions: TickerOption[] = [
    { symbol: '^GSPC', name: 'S&P 500 Index' },
    { symbol: '^DJI', name: 'Dow Jones Industrial Average' },
    { symbol: '^IXIC', name: 'NASDAQ Composite' },
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'NVDA', name: 'NVIDIA' },
    { symbol: 'AMZN', name: 'Amazon' },
    { symbol: 'GOOGL', name: 'Alphabet Class A' },
    { symbol: 'META', name: 'Meta Platforms' },
    { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'V', name: 'Visa' },
    { symbol: 'MA', name: 'Mastercard' },
    { symbol: 'JNJ', name: 'Johnson & Johnson' },
    { symbol: 'XOM', name: 'Exxon Mobil' },
    { symbol: 'CVX', name: 'Chevron' },
    { symbol: 'WMT', name: 'Walmart' },
    { symbol: 'PG', name: 'Procter & Gamble' },
    { symbol: 'HD', name: 'Home Depot' },
    { symbol: 'KO', name: 'Coca-Cola' },
    { symbol: 'BAC', name: 'Bank of America' },
    { symbol: 'PFE', name: 'Pfizer' },
    { symbol: 'UNH', name: 'UnitedHealth Group' },
    { symbol: 'ORCL', name: 'Oracle' },
    { symbol: 'NFLX', name: 'Netflix' },
    { symbol: 'DIS', name: 'Walt Disney' }
  ];
  ranges = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y'];
  activeRange = '5d';

  private chart: Chart | null = null;
  private clockInterval: any;
  private refreshInterval: any;
  private loadSeq = 0;
  private activeLoadSub?: Subscription;
  private lastRequestAt = 0;

  private readonly minRequestGapMs = 8000;
  private readonly shortCacheMs = 120000;
  private readonly longCacheMs = 600000;
  private simPositions: Record<string, SimPosition> = {};

  constructor(private http: HttpClient, private zone: NgZone, @Inject(Storage) private storage: Storage, private route: ActivatedRoute, private router: Router) {}

  async ngOnInit() {
    await this.storage.create();
    const savedRange = await this.storage.get('range');
    const savedSymbol = await this.storage.get('symbol');
    this.currency = (await this.storage.get('settings.currency')) ?? 'USD';
    this.defaultSymbol = ((await this.storage.get('settings.defaultSymbol')) ?? '^GSPC').toString().trim().toUpperCase() || '^GSPC';
    const routeSymbol = this.route.snapshot.queryParamMap.get('symbol');
    if (routeSymbol?.trim()) {
      this.symbol = routeSymbol.trim().toUpperCase();
    } else {
      this.symbol = (savedSymbol ?? this.defaultSymbol).toString().trim().toUpperCase() || '^GSPC';
    }
    this.symbolInput = this.symbol;
    await this.storage.set('symbol', this.symbol);
    await this.loadSimState();
    await this.loadExperienceState();
    if (typeof savedRange === 'string' && this.ranges.includes(savedRange)) {
      this.activeRange = savedRange;
    }

    this.tickClock();
    this.clockInterval = setInterval(() => this.tickClock(), 1000);
    this.loadChart(this.activeRange);
    this.refreshInterval = setInterval(() => this.loadChart(this.activeRange), this.autoRefreshSec * 1000);
  }

  ngOnDestroy() {
    clearInterval(this.clockInterval);
    clearInterval(this.refreshInterval);
    this.activeLoadSub?.unsubscribe();
    if (this.chart) this.chart.destroy();
  }

  tickClock() {
    const now = new Date();
    this.currentTime = now.toLocaleTimeString('en-US', { hour12: false });
    this.currentDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  }

  async selectRange(r: string) {
    this.activeRange = r;
    await this.storage.set('range', r);
    this.loadChart(r);
  }

  async applySymbol() {
    const nextSymbol = this.symbolInput.trim().toUpperCase();
    if (!nextSymbol) return;
    this.symbol = nextSymbol;
    await this.storage.set('symbol', this.symbol);
    if (!this.watchlist.includes(this.symbol)) {
      this.watchlist = [this.symbol, ...this.watchlist].slice(0, 12);
      await this.persistWatchlist();
    }
    this.refreshSimMetrics();
    this.evaluateAlerts();
    this.showSuggestions = false;
    this.loadChart(this.activeRange);
  }

  private async loadSimState(): Promise<void> {
    const savedCash = await this.storage.get('simCash');
    const savedPositions = await this.storage.get('simPositions');
    const savedTrades = await this.storage.get('simTrades');

    this.simCash = typeof savedCash === 'number' ? savedCash : 100000;
    this.simPositions = typeof savedPositions === 'object' && savedPositions ? savedPositions : {};
    this.recentTrades = Array.isArray(savedTrades) ? savedTrades.slice(0, 20) : [];
    this.refreshSimMetrics();
  }

  private async loadExperienceState(): Promise<void> {
    const sRefresh = Number(await this.storage.get('settings.autoRefreshSec'));
    if (Number.isFinite(sRefresh) && sRefresh >= 30 && sRefresh <= 600) {
      this.autoRefreshSec = Math.round(sRefresh);
    }

    const defaultWatch = [this.defaultSymbol, 'AAPL', 'MSFT', 'NVDA'];
    const savedWatch = await this.storage.get('watchlist');
    const source = Array.isArray(savedWatch) ? savedWatch : defaultWatch;
    this.watchlist = Array.from(new Set(
      source
        .map(item => String(item || '').trim().toUpperCase())
        .filter(Boolean)
    )).slice(0, 12);

    if (!this.watchlist.includes(this.symbol)) {
      this.watchlist.unshift(this.symbol);
      this.watchlist = Array.from(new Set(this.watchlist)).slice(0, 12);
    }
    await this.persistWatchlist();

    const savedAlerts = await this.storage.get('priceAlerts');
    this.priceAlerts = Array.isArray(savedAlerts)
      ? savedAlerts
          .map(row => this.normalizeAlert(row))
          .filter((x): x is PriceAlert => x !== null)
          .slice(0, 30)
      : [];
  }

  private normalizeAlert(raw: unknown): PriceAlert | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const row = raw as Record<string, unknown>;
    const id = typeof row['id'] === 'string' ? row['id'] : '';
    const symbol = typeof row['symbol'] === 'string' ? row['symbol'].trim().toUpperCase() : '';
    const direction = row['direction'] === 'below' ? 'below' : row['direction'] === 'above' ? 'above' : '';
    const target = Number(row['target']);
    const createdAt = typeof row['createdAt'] === 'string' ? row['createdAt'] : '';
    const triggeredAt = typeof row['triggeredAt'] === 'string' ? row['triggeredAt'] : undefined;

    if (!id || !symbol || !direction || !Number.isFinite(target) || target <= 0 || !createdAt) return null;
    return { id, symbol, direction, target, createdAt, triggeredAt };
  }

  private async persistSimState(): Promise<void> {
    await this.storage.set('simCash', this.simCash);
    await this.storage.set('simPositions', this.simPositions);
    await this.storage.set('simTrades', this.recentTrades.slice(0, 20));
  }

  private async persistWatchlist(): Promise<void> {
    await this.storage.set('watchlist', this.watchlist.slice(0, 12));
  }

  private async persistAlerts(): Promise<void> {
    await this.storage.set('priceAlerts', this.priceAlerts.slice(0, 30));
  }

  private refreshSimMetrics(): void {
    const p = this.simPositions[this.symbol] ?? { qty: 0, avgCost: 0 };
    this.currentPositionQty = p.qty;
    this.currentPositionAvg = p.avgCost;
    this.currentPositionValue = p.qty * this.currentPriceNum;
    this.currentPositionUnrealized = p.qty * (this.currentPriceNum - p.avgCost);
  }

  async buyAtMarket(): Promise<void> {
    const qty = Math.floor(Number(this.tradeQtyInput));
    if (!qty || qty <= 0) {
      this.tradeMessage = 'Enter a valid quantity';
      return;
    }
    if (this.currentPriceNum <= 0) {
      this.tradeMessage = 'Price unavailable';
      return;
    }

    const total = qty * this.currentPriceNum;
    if (total > this.simCash) {
      this.tradeMessage = 'Insufficient cash';
      return;
    }

    const existing = this.simPositions[this.symbol] ?? { qty: 0, avgCost: 0 };
    const nextQty = existing.qty + qty;
    const nextAvg = ((existing.qty * existing.avgCost) + total) / nextQty;

    this.simPositions[this.symbol] = { qty: nextQty, avgCost: nextAvg };
    this.simCash -= total;
    this.recentTrades.unshift({ side: 'BUY', symbol: this.symbol, qty, price: this.currentPriceNum, total, at: new Date().toISOString() });
    this.tradeMessage = `Bought ${qty} ${this.symbol} @ ${this.fmt(this.currentPriceNum)}`;
    this.refreshSimMetrics();
    await this.persistSimState();
  }

  async sellAtMarket(): Promise<void> {
    const qty = Math.floor(Number(this.tradeQtyInput));
    if (!qty || qty <= 0) {
      this.tradeMessage = 'Enter a valid quantity';
      return;
    }
    if (this.currentPriceNum <= 0) {
      this.tradeMessage = 'Price unavailable';
      return;
    }

    const existing = this.simPositions[this.symbol] ?? { qty: 0, avgCost: 0 };
    if (existing.qty < qty) {
      this.tradeMessage = 'Not enough shares to sell';
      return;
    }

    const total = qty * this.currentPriceNum;
    const remaining = existing.qty - qty;

    if (remaining <= 0) {
      delete this.simPositions[this.symbol];
    } else {
      this.simPositions[this.symbol] = { qty: remaining, avgCost: existing.avgCost };
    }

    this.simCash += total;
    this.recentTrades.unshift({ side: 'SELL', symbol: this.symbol, qty, price: this.currentPriceNum, total, at: new Date().toISOString() });
    this.tradeMessage = `Sold ${qty} ${this.symbol} @ ${this.fmt(this.currentPriceNum)}`;
    this.refreshSimMetrics();
    await this.persistSimState();
  }

  get symbolName(): string {
    const match = this.tickerOptions.find(t => t.symbol.toUpperCase() === this.symbol.toUpperCase());
    return match?.name ?? 'MARKET SNAPSHOT';
  }

  get openAlertsForSymbol(): PriceAlert[] {
    return this.priceAlerts.filter(a => a.symbol === this.symbol && !a.triggeredAt).slice(0, 5);
  }

  get triggeredAlertsForSymbol(): PriceAlert[] {
    return this.priceAlerts.filter(a => a.symbol === this.symbol && !!a.triggeredAt).slice(0, 5);
  }

  get recentTradesView(): SimTrade[] {
    return this.recentTrades.slice(0, 6);
  }

  get isCurrentWatched(): boolean {
    return this.watchlist.includes(this.symbol);
  }

  async toggleWatchCurrent(): Promise<void> {
    const symbol = this.symbol.trim().toUpperCase();
    if (!symbol) return;

    if (this.watchlist.includes(symbol)) {
      this.watchlist = this.watchlist.filter(s => s !== symbol);
      if (!this.watchlist.length) this.watchlist = [symbol];
    } else {
      this.watchlist = [symbol, ...this.watchlist].slice(0, 12);
    }

    await this.persistWatchlist();
  }

  loadWatchSymbol(symbol: string): void {
    this.symbolInput = symbol;
    this.applySymbol();
  }

  async addPriceAlert(): Promise<void> {
    const target = Number(this.alertTargetInput);
    if (!Number.isFinite(target) || target <= 0) {
      this.alertStatus = 'Enter a valid alert target';
      return;
    }

    const symbol = this.symbol.trim().toUpperCase();
    const duplicate = this.priceAlerts.some(a =>
      !a.triggeredAt &&
      a.symbol === symbol &&
      a.direction === this.alertDirectionInput &&
      Math.abs(a.target - target) < 0.0001
    );

    if (duplicate) {
      this.alertStatus = 'An identical alert already exists';
      return;
    }

    const alert: PriceAlert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol,
      direction: this.alertDirectionInput,
      target,
      createdAt: new Date().toISOString()
    };

    this.priceAlerts = [alert, ...this.priceAlerts].slice(0, 30);
    this.alertStatus = `Alert armed: ${symbol} ${this.alertDirectionInput === 'above' ? '>' : '<'} ${this.money(target)}`;
    this.alertTargetInput = null;
    await this.persistAlerts();
    this.evaluateAlerts();
  }

  async removeAlert(id: string): Promise<void> {
    this.priceAlerts = this.priceAlerts.filter(a => a.id !== id);
    await this.persistAlerts();
  }

  async clearTriggeredAlerts(): Promise<void> {
    this.priceAlerts = this.priceAlerts.filter(a => !a.triggeredAt);
    await this.persistAlerts();
    this.alertStatus = 'Triggered alerts cleared';
  }

  tradeTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  }

  onSymbolInputChange(value: string): void {
    this.symbolInput = value.toUpperCase();
    this.suggestions = this.getFuzzySuggestions(this.symbolInput);
    this.showSuggestions = this.suggestions.length > 0 && this.symbolInput.trim().length > 0;
  }

  chooseSuggestion(item: TickerOption): void {
    this.symbolInput = item.symbol;
    this.showSuggestions = false;
    this.applySymbol();
  }

  hideSuggestionsSoon(): void {
    setTimeout(() => {
      this.showSuggestions = false;
    }, 120);
  }

  private getFuzzySuggestions(input: string): TickerOption[] {
    const q = input.trim().toUpperCase();
    if (!q) return [];

    const ranked = this.tickerOptions
      .map(option => ({ option, score: this.fuzzyScore(q, option.symbol, option.name.toUpperCase()) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(x => x.option);

    return ranked;
  }

  private fuzzyScore(query: string, symbol: string, name: string): number {
    const s = symbol.toUpperCase();
    if (s === query) return 1000;
    if (s.startsWith(query)) return 800 - (s.length - query.length);
    if (name.startsWith(query)) return 700 - (name.length - query.length) * 0.5;

    const subSymbol = this.subsequenceScore(query, s);
    const subName = this.subsequenceScore(query, name);
    return Math.max(subSymbol * 10 + 100, subName * 6 + 60, 0);
  }

  private subsequenceScore(query: string, target: string): number {
    let qi = 0;
    let bonus = 0;
    let lastMatch = -2;

    for (let i = 0; i < target.length && qi < query.length; i++) {
      if (target[i] === query[qi]) {
        bonus += 1;
        if (i === lastMatch + 1) bonus += 2;
        if (i === 0) bonus += 2;
        lastMatch = i;
        qi++;
      }
    }

    return qi === query.length ? bonus : 0;
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
    this.router.navigate(['/market'], { queryParams: { symbol: this.symbol } });
  }

  goSettings(): void {
    this.navExpanded = false;
    this.router.navigate(['/settings']);
  }

  fmt(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  money(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '—';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: this.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch {
      return `$${this.fmt(n)}`;
    }
  }

  private evaluateAlerts(): void {
    if (this.currentPriceNum <= 0) return;

    let changed = false;
    let latestTriggeredDirection: PriceAlertDirection | null = null;
    let latestTriggeredTarget: number | null = null;
    this.priceAlerts = this.priceAlerts.map(alert => {
      if (alert.triggeredAt || alert.symbol !== this.symbol) return alert;

      const hit = alert.direction === 'above'
        ? this.currentPriceNum >= alert.target
        : this.currentPriceNum <= alert.target;

      if (!hit) return alert;

      changed = true;
      const triggered: PriceAlert = { ...alert, triggeredAt: new Date().toISOString() };
      latestTriggeredDirection = triggered.direction;
      latestTriggeredTarget = triggered.target;
      return triggered;
    });

    if (changed && latestTriggeredDirection && latestTriggeredTarget != null) {
      const directionLabel = latestTriggeredDirection === 'above' ? 'above' : 'below';
      this.alertStatus = `Alert triggered: ${this.symbol} moved ${directionLabel} ${this.money(latestTriggeredTarget)}`;
      this.tradeMessage = this.alertStatus;
      void this.persistAlerts();
    }
  }

  private updateMarketAnalytics(prices: number[]): void {
    if (prices.length < 2) {
      this.trendSignal = 'RANGE-BOUND';
      this.trendConfidence = 0;
      this.trendReturnPct = 0;
      this.volatilityPct = 0;
      return;
    }

    const first = prices[0];
    const last = prices[prices.length - 1];
    this.trendReturnPct = first ? ((last - first) / first) * 100 : 0;

    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1];
      if (!prev) continue;
      returns.push((prices[i] - prev) / prev);
    }

    if (!returns.length) {
      this.volatilityPct = 0;
      this.trendConfidence = Math.min(99, Math.round(Math.abs(this.trendReturnPct) * 8));
      this.trendSignal = this.trendReturnPct >= 0 ? 'BULLISH' : 'BEARISH';
      return;
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) / returns.length;
    this.volatilityPct = Math.sqrt(Math.max(variance, 0)) * Math.sqrt(252) * 100;

    const momentum = Math.abs(this.trendReturnPct);
    this.trendConfidence = Math.min(99, Math.round(momentum * 7 + Math.max(0, 20 - this.volatilityPct)));

    if (this.trendReturnPct > 0.6) {
      this.trendSignal = this.volatilityPct > 45 ? 'BULLISH / VOLATILE' : 'BULLISH';
      return;
    }

    if (this.trendReturnPct < -0.6) {
      this.trendSignal = this.volatilityPct > 45 ? 'BEARISH / VOLATILE' : 'BEARISH';
      return;
    }

    this.trendSignal = 'RANGE-BOUND';
  }

  private fetchChartData(range: string, interval: string, symbol: string): Observable<{ meta: any; timestamps: number[]; closes: Array<number | null> }> {
    const url = `${environment.apiBaseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    return this.http.get<any>(url).pipe(
      map(response => {
        const result = response?.chart?.result?.[0];
        return {
          meta: result?.meta ?? {},
          timestamps: result?.timestamp ?? [],
          closes: result?.indicators?.quote?.[0]?.close ?? []
        };
      })
    );
  }

  private cacheKey(symbol: string, range: string, interval: string): string {
    return `chart:${symbol}:${range}:${interval}`;
  }

  private cacheTtl(range: string): number {
    return range === '1d' || range === '5d' ? this.shortCacheMs : this.longCacheMs;
  }

  private async readCached(symbol: string, range: string, interval: string): Promise<{ meta: any; timestamps: number[]; closes: Array<number | null> } | null> {
    const key = this.cacheKey(symbol, range, interval);
    const cached = await this.storage.get(key);
    if (!cached?.savedAt || !cached?.data) return null;
    if (Date.now() - Number(cached.savedAt) > this.cacheTtl(range)) return null;
    return cached.data;
  }

  private async writeCache(symbol: string, range: string, interval: string, data: { meta: any; timestamps: number[]; closes: Array<number | null> }): Promise<void> {
    const key = this.cacheKey(symbol, range, interval);
    await this.storage.set(key, { savedAt: Date.now(), data });
  }

  private applyDataToView(range: string, data: { meta: any; timestamps: number[]; closes: Array<number | null> }): void {
    const meta = data.meta ?? {};
    const timestamps: number[] = data.timestamps ?? [];
    const closes: Array<number | null> = data.closes ?? [];

    const prices: number[] = [];
    const labels: string[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null) continue;
      prices.push(+close.toFixed(2));
      const d = new Date(timestamps[i] * 1000);
      if (range === '1d' || range === '5d') {
        labels.push(d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
      } else if (range === '1mo' || range === '3mo') {
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      } else {
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }));
      }
    }

    if (!prices.length) {
      this.zone.run(() => {
        this.loading = true;
        this.loadingMsg = 'FAILED TO LOAD — EMPTY MARKET DATA';
      });
      return;
    }

    const cur = Number(meta.regularMarketPrice ?? prices[prices.length - 1]);
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose ?? prices[0] ?? cur);
    const chgAbs = cur - prev;
    const chgPct = prev ? (chgAbs / prev) * 100 : 0;
    const isUp = chgAbs >= 0;

    this.zone.run(() => {
      this.currentPriceNum = cur;
      this.price = this.fmt(cur);
      this.changeClass = isUp ? 'up' : 'dn';
      this.change = `${isUp ? '+' : ''}${this.fmt(chgAbs)} (${isUp ? '+' : ''}${chgPct.toFixed(2)}%)`;
      this.statOpen = this.fmt(meta.regularMarketOpen ?? prices[0]);
      this.statHigh = this.fmt(meta.regularMarketDayHigh ?? Math.max(...prices));
      this.statLow = this.fmt(meta.regularMarketDayLow ?? Math.min(...prices));
      this.statPrev = this.fmt(prev);
      this.stat52h = this.fmt(meta.fiftyTwoWeekHigh);
      this.stat52l = this.fmt(meta.fiftyTwoWeekLow);
      this.updateMarketAnalytics(prices);
      this.refreshSimMetrics();
      this.evaluateAlerts();
      this.loading = false;
      this.renderChart(labels, prices, isUp);
    });
  }

  async loadChart(range: string): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.loadingMsg = 'LOADING MARKET DATA...';

    const interval = range === '1d' ? '5m' : range === '5d' ? '30m' : '1d';
    const cached = await this.readCached(this.symbol, range, interval);
    if (cached && seq === this.loadSeq) {
      this.applyDataToView(range, cached);
      return;
    }

    const gap = Date.now() - this.lastRequestAt;
    if (gap < this.minRequestGapMs && seq === this.loadSeq) {
      this.loadingMsg = 'WAITING TO AVOID RATE LIMIT...';
      setTimeout(() => {
        if (seq === this.loadSeq) this.loadChart(range);
      }, this.minRequestGapMs - gap);
      return;
    }

    this.activeLoadSub?.unsubscribe();
    this.lastRequestAt = Date.now();

    this.activeLoadSub = this.fetchChartData(range, interval, this.symbol).pipe(take(1)).subscribe({
      next: async data => {
        if (seq !== this.loadSeq) return;
        await this.writeCache(this.symbol, range, interval, data);
        this.applyDataToView(range, data);
      },
      error: async (err: unknown) => {
        if (seq !== this.loadSeq) return;
        const previousCached = await this.readCached(this.symbol, range, interval);
        if (previousCached) {
          this.applyDataToView(range, previousCached);
          this.loadingMsg = 'SHOWING CACHED DATA';
          return;
        }

        const status = err instanceof HttpErrorResponse ? err.status : 0;
        this.zone.run(() => {
          this.loading = true;
          this.loadingMsg = status === 429 ? 'RATE LIMITED — TRY AGAIN IN A MOMENT' : 'FAILED TO LOAD — REST API UNAVAILABLE';
        });
      }
    });
  }

  renderChart(labels: string[], prices: number[], isUp: boolean) {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    const lineColor = isUp ? '#00cc44' : '#ff3333';
    const fillColor = isUp ? 'rgba(0,204,68,0.08)' : 'rgba(255,51,51,0.08)';

    this.chart = new Chart(this.chartCanvas.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: prices,
          borderColor: lineColor,
          backgroundColor: fillColor,
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: '#111',
            borderColor: '#333',
            borderWidth: 1,
            titleColor: '#ff9900',
            bodyColor: '#ccc',
            callbacks: { label: (ctx: TooltipItem<'line'>) => ' ' + this.fmt(ctx.parsed.y) }
          }
        },
        scales: {
          x: {
            grid: { color: '#111' },
            ticks: { color: '#444', font: { family: 'monospace', size: 9 }, maxTicksLimit: 8, maxRotation: 0 },
            border: { color: '#222' }
          },
          y: {
            position: 'right',
            grid: { color: '#111' },
            ticks: { color: '#555', font: { family: 'monospace', size: 9 }, callback: (v: string | number) => this.fmt(Number(v)) },
            border: { color: '#222' }
          }
        },
        interaction: { mode: 'index', intersect: false }
      }
    });
  }
}