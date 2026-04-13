import { Component, OnInit, OnDestroy, ElementRef, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { IonContent } from '@ionic/angular/standalone';
import { Chart, registerables, TooltipItem } from 'chart.js';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

Chart.register(...registerables);

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IonContent],
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

  ranges = ['1d','5d','1mo','3mo','6mo','1y','5y'];
  activeRange = '5d';

  private chart: Chart | null = null;
  private clockInterval: any;
  private refreshInterval: any;
  private loadSeq = 0;

  constructor(private http: HttpClient, private zone: NgZone) {}

  ngOnInit() {
    this.tickClock();
    this.clockInterval = setInterval(() => this.tickClock(), 1000);
    this.loadChart(this.activeRange);
    this.refreshInterval = setInterval(() => this.loadChart(this.activeRange), 30000);
  }

  ngOnDestroy() {
    clearInterval(this.clockInterval);
    clearInterval(this.refreshInterval);
    if (this.chart) this.chart.destroy();
  }

  tickClock() {
    const now = new Date();
    this.currentTime = now.toLocaleTimeString('en-US', { hour12: false });
    this.currentDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  }

  selectRange(r: string) {
    this.activeRange = r;
    this.loadChart(r);
  }

  fmt(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private async fetchChartData(range: string, interval: string, symbol: string): Promise<any> {
    const url = `${environment.apiBaseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const response = await firstValueFrom(this.http.get<any>(url));
    const result = response?.chart?.result?.[0];

    return {
      meta: result?.meta ?? {},
      timestamps: result?.timestamp ?? [],
      closes: result?.indicators?.quote?.[0]?.close ?? []
    };
  }

  async loadChart(range: string): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.loadingMsg = 'LOADING MARKET DATA...';

    const symbol = '^GSPC';
    const interval = range === '1d' ? '5m' : range === '5d' ? '30m' : '1d';

    try {
      const data = await this.fetchChartData(range, interval, symbol);
      if (seq !== this.loadSeq) return;

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

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

      if (!prices.length) throw new Error('No chart data returned');

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
        this.statLow  = this.fmt(meta.regularMarketDayLow ?? Math.min(...prices));
        this.statPrev = this.fmt(prev);
        this.stat52h  = this.fmt(meta.fiftyTwoWeekHigh);
        this.stat52l  = this.fmt(meta.fiftyTwoWeekLow);
        this.loading  = false;
        this.renderChart(labels, prices, isUp);
      });
    } catch {
      if (seq !== this.loadSeq) return;
      this.zone.run(() => {
        this.loading = true;
        this.loadingMsg = 'FAILED TO LOAD — REST API UNAVAILABLE';
      });
    }
  }

  renderChart(labels: string[], prices: number[], isUp: boolean) {
    if (this.chart) { this.chart.destroy(); this.chart = null; }

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