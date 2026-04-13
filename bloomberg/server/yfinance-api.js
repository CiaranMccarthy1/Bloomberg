const express = require('express');
const cors = require('cors');
const YahooFinance = require('yahoo-finance2').default;

const app = express();
const yf = new YahooFinance();
const port = Number(process.env.PORT) || 3001;

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

app.listen(port, () => {
  console.log(`yfinance API listening on http://localhost:${port}`);
});
