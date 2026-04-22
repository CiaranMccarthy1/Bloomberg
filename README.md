# Bloomberg Market PWA

## 1. Project Overview
This is an Ionic + Angular standalone Progressive Web Application that simulates a Bloomberg-style market terminal for educational trading and portfolio analysis.

Core modules:
- Dashboard for portfolio monitoring, weekly leaders, market heat map, and finance news.
- Market screen for chart-based symbol analysis and simulated buy/sell execution.
- Settings for personalization, simulator controls, and analytics configuration.
- Device screen powered by Capacitor Device API.

## 2. High-Grade Feature Highlights 
The following features were specifically implemented to exceed the minimum requirements:

1. Portfolio Coach Analytics Engine:
- Goal tracking against a configurable target portfolio value.
- Settings-driven risk profile model (`conservative`, `balanced`, `aggressive`).
- Health score combining P/L trend, diversification, and concentration risk.
- Real-time coaching message for rebalance/growth decisions.

2. Smart Trading Intelligence:
- Persistent watchlist with one-click symbol switching.
- Price alerts (above/below target) with trigger state and alert history.
- Trend signal metrics (`bullish`, `bearish`, `range-bound`) with confidence and volatility.
- Recent execution tape for professional trading feedback.

3. Advanced Personalization:
- New settings for risk profile, portfolio target, watchlist seed list, and market auto-refresh frequency.
- Theme and font scaling preserved with Ionic Storage.
- Profile export includes all new analytics settings.

4. UX and Aesthetic Upgrade:
- Rich gradient-based visual layers, improved panel hierarchy, and responsive card systems.
- Fast navigation via side drawer and context-aware controls across screens.

## 3. Minimum Requirement Coverage
This application meets all required baseline criteria:

- Angular framework with standalone components.
- App runs with Ionic tooling (`ionic serve`).
- Data binding with interpolation and two-way binding.
- Angular Router with dedicated screens.
- Capacitor native integration via Device plugin.
- External JSON/API consumption via `HttpClient` Observables.
- Persistent data storage using Ionic Storage.

## 4. Main Screens
### Dashboard
- Portfolio now summary (cash, P/L, sector allocation, account history).
- Top weekly performers, heat map tiles, and live market news.
- Portfolio Coach panel with target progress, health score, concentration, and diversification metrics.

### Market
- Symbol fuzzy search and quick watchlist switching.
- Multi-range chart rendering with cached API data and rate-limit protection.
- Simulated buy/sell orders with persistent positions, cash, and trade history.
- Price alert management and trend-intelligence calculations.

### Settings
- User profile controls and display preferences.
- Risk profile and target portfolio configuration.
- Auto-refresh interval tuning and watchlist seed editing.
- Simulator reset and profile export.

### Device
- Platform, OS, and model information from Capacitor Device API.
- Displays persisted market symbol and active chart range.

## 5. Data Sources
- Yahoo Finance chart endpoint (through app proxy) for quote/chart data.
- Hacker News Algolia API for market-related headlines.
- Local seed data from `src/assets/user-data.json`.

## 6. Persistence Model
Stored in Ionic Storage:
- `settings.userName`
- `settings.defaultSymbol`
- `settings.currency`
- `settings.theme`
- `settings.fontSize`
- `settings.riskProfile`
- `settings.targetPortfolio`
- `settings.autoRefreshSec`
- `symbol`
- `range`
- `watchlist`
- `priceAlerts`
- `simCash`
- `simPositions`
- `simTrades`

## 7. Installation and Startup
Prerequisites:
- Node.js LTS
- Ionic CLI 7+

Steps:
1. Clone the repository.
2. Open terminal in the project folder.
3. Run `npm install`.
4. Run `ionic serve`.
5. Open the served local URL.

## 8. Build Verification
To create a production build:
- Run `npm run build`

Recommended pre-submission check:
1. Fresh clone.
2. `npm install`.
3. `ionic serve`.
4. Navigate all routes and verify API-backed widgets render.



## 10. Troubleshooting
If API data fails:
- Confirm internet access.
- Restart `ionic serve`.
- Confirm proxy configuration.

If startup fails:
- Remove `node_modules`.
- Re-run `npm install`.
- Re-run `ionic serve`.

If portfolio state is unexpected:
- Use Settings reset action.
- Reload the app.