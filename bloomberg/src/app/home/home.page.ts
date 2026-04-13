import { Component, OnInit, OnDestroy, ElementRef, ViewChild, NgZone, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Chart, registerables, TooltipItem } from 'chart.js';
import { Observable, Subscription, map, take } from 'rxjs';
import { Storage } from '@ionic/storage-angular';
import { environment } from '../../environments/environment';

Chart.register(...registerables);

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

  symbol = '^GSPC';
  symbolInput = '^GSPC';
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

  constructor(private http: HttpClient, private zone: NgZone, @Inject(Storage) private storage: Storage, private route: ActivatedRoute) {}

  async ngOnInit() {
    await this.storage.create();
    const savedSymbol = await this.storage.get('symbol');
    const savedRange = await this.storage.get('range');
    if (typeof savedSymbol === 'string' && savedSymbol.trim()) {
      this.symbol = savedSymbol.trim().toUpperCase();
      this.symbolInput = this.symbol;
    }
    const routeSymbol = this.route.snapshot.queryParamMap.get('symbol');
    if (routeSymbol?.trim()) {
      this.symbol = routeSymbol.trim().toUpperCase();
      this.symbolInput = this.symbol;
      await this.storage.set('symbol', this.symbol);
    }
    if (typeof savedRange === 'string' && this.ranges.includes(savedRange)) {
      this.activeRange = savedRange;
    }

    this.tickClock();
    this.clockInterval = setInterval(() => this.tickClock(), 1000);
    this.loadChart(this.activeRange);
    this.refreshInterval = setInterval(() => this.loadChart(this.activeRange), 180000);
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
    this.loadChart(this.activeRange);
  }

  fmt(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      this.price = this.fmt(cur);
      this.changeClass = isUp ? 'up' : 'dn';
      this.change = `${isUp ? '+' : ''}${this.fmt(chgAbs)} (${isUp ? '+' : ''}${chgPct.toFixed(2)}%)`;
      this.statOpen = this.fmt(meta.regularMarketOpen ?? prices[0]);
      this.statHigh = this.fmt(meta.regularMarketDayHigh ?? Math.max(...prices));
      this.statLow = this.fmt(meta.regularMarketDayLow ?? Math.min(...prices));
      this.statPrev = this.fmt(prev);
      this.stat52h = this.fmt(meta.fiftyTwoWeekHigh);
      this.stat52l = this.fmt(meta.fiftyTwoWeekLow);
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