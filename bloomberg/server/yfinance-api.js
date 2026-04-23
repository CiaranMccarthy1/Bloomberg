const express = require('express');
const cors = require('cors');
const YahooFinance = require('yahoo-finance2').default;
const fs = require('fs');
const path = require('path');

const app = express();
const yf = new YahooFinance();
const port = Number(process.env.PORT) || 3001;

function loadDotEnv() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;

    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key && process.env[key] == null) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn('Failed to load .env file:', error instanceof Error ? error.message : String(error));
  }
}

loadDotEnv();

app.use(cors());

const allowedIntervals = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo']);

app.get('/api/yfinance/chart', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '^GSPC');
    const range = String(req.query.range || '5d');

    const defaultInterval = range === '1d' ? '5m' : range === '5d' ? '30m' : '1d';
    const interval = String(req.query.interval || defaultInterval);

    if (!allowedIntervals.has(interval)) {
      return res.status(400).json({ error: 'Unsupported interval' });
    }

    const query = new URLSearchParams({
      interval,
      range,
      includePrePost: 'false',
      events: 'div,splits'
    });

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query.toString()}`;
    const response = await yf._fetch(yahooUrl);
    const result = response?.chart?.result?.[0];

    if (!result) {
      return res.status(502).json({ error: 'No chart result from Yahoo Finance' });
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    return res.json({
      meta: result.meta || {},
      timestamps,
      closes
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return res.status(500).json({ error: message });
  }
});

app.get('/api/yfinance/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/news', async (req, res) => {
  try {
    const apiKey = String(process.env.NEWS_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(500).json({ error: 'NEWS_API_KEY not configured' });
    }

    const q = String(req.query.q || 'stock market');
    const language = String(req.query.language || 'en');
    const pageSize = Math.min(20, Math.max(1, Number(req.query.pageSize) || 8));

    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', q);
    url.searchParams.set('language', language);
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('pageSize', String(pageSize));

    const response = await fetch(url, {
      headers: {
        'X-Api-Key': apiKey
      }
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: 'News API request failed', detail: body });
    }

    const payload = await response.json();
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];

    const rows = articles
      .map(a => ({
        source: String(a?.source?.name || 'NEWS').toUpperCase(),
        title: String(a?.title || '').trim(),
        url: String(a?.url || '').trim()
      }))
      .filter(a => a.title)
      .slice(0, pageSize);

    return res.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return res.status(500).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`yfinance API listening on http://localhost:${port}`);
});
