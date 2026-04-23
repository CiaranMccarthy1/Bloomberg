export type BoughtStock = { symbol: string; quantity: number; avgBuyPrice: number };
export type UserData = { user: string; balance: number; boughtStocks: BoughtStock[] };
export type SimPosition = { qty: number; avgCost: number };
export type SimTrade = { side: 'BUY' | 'SELL'; symbol: string; qty: number; price: number; total: number; at: string };
export type StockView = BoughtStock & { currentPrice: number; cost: number; value: number; pnl: number; pnlPct: number };
export type MarketItem = { symbol: string; price: number; weekPct: number };
export type SectorSlice = { sector: string; value: number; pct: number };
export type HistoryPoint = { label: string; value: number };
export type HeatTile = { symbol: string; change: number; size: 'lg' | 'md' | 'sm' };
export type RiskProfile = 'conservative' | 'balanced' | 'aggressive';

export type TickerOption = { symbol: string; name: string };
export type PriceAlertDirection = 'above' | 'below';
export type PriceAlert = { id: string; symbol: string; direction: PriceAlertDirection; target: number; createdAt: string; triggeredAt?: string };
