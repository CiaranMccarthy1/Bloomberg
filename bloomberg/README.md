# Bloomberg Market PWA - User Guide

## 1. Project Overview
This Progressive Web Application provides a Bloomberg-style market dashboard and trading simulator built with Ionic and Angular standalone components.

The app includes:
- A real-time style dashboard with portfolio summary, sector allocation, heat map, and market news.
- A trading screen with symbol search, chart ranges, buy and sell simulation, and position tracking.
- A settings screen for profile preferences and simulator reset/export.
- A device screen that displays runtime platform details using Capacitor Device API.

## 2. Minimum Requirement Coverage
This project satisfies the Front-End Web Development 2026 minimum requirements as follows:

- Angular framework with standalone components:
  - All pages are standalone components and loaded via Angular router.
- Application runs with Ionic serve:
  - Standard Angular/Ionic start command is supported after dependency install.
- Data binding:
  - Interpolation is used across all views.
  - Two-way binding is used in settings and trading controls.
- Angular Router:
  - Dedicated routes for dashboard, market, settings, and device screens.
- Ionic Native/Capacitor plugin:
  - Capacitor Device plugin is used on the Device page.
- Read JSON from external URL using Observable and provideHttpClient:
  - Market and news data are loaded from external APIs using HttpClient observables.
- Data persistence with Ionic Storage:
  - App settings and simulated portfolio state are persisted via Ionic Storage.

## 3. Installation and Startup
Prerequisites:
- Node.js LTS
- Ionic CLI 7 or higher

Steps:
1. Clone the repository.
2. Open a terminal in the bloomberg project folder.
3. Run: npm install
4. Run: ionic serve
5. Open the local URL shown in terminal output.

## 4. Main Screens
### Dashboard
- Displays user portfolio value, cash, profit and loss, sector allocation, account history, top weekly performers, and market heat map.
- Ticker and cards are populated from API responses and computed aggregates.

### Trading
- Supports symbol search and selection.
- Displays chart and key quote stats across multiple time ranges.
- Allows simulated buy and sell actions.
- Updates cash, position quantity, average cost, market value, and unrealized P and L.

### Settings
- Stores user name, default symbol, currency, theme, and font size.
- Includes simulator reset and profile export.

### Device
- Shows platform, operating system, and model from Capacitor Device API.
- Shows persisted symbol and selected chart range.

## 5. Data Sources
- Yahoo Finance chart endpoint through Angular proxy for quote and chart series data.
- Hacker News Algolia API for market-related headline feed.
- Local seed data file for initial user profile values.

## 6. Persistence Model
Data is stored in Ionic Storage and survives browser refresh/restart:
- settings.userName
- settings.defaultSymbol
- settings.currency
- settings.theme
- settings.fontSize
- symbol
- range
- simCash
- simPositions
- simTrades

## 7. Build and Verification
To create a production build:
- Run: npm run build

Before submission, verify on another machine:
1. Fresh clone of repository.
2. Run npm install.
3. Run ionic serve.
4. Confirm all routes load and API data appears.

## 8. Viva Preparation Checklist
Be ready to explain clearly:
- Why standalone components were used.
- How router-driven navigation is structured.
- Where and why two-way data binding is required.
- How Observable pipelines process market data.
- How and why caching/rate limiting logic is implemented.
- How Ionic Storage is initialized and used.
- How the Capacitor Device plugin is integrated.
- Error-handling and fallback strategy when APIs fail.

## 9. Troubleshooting
If API requests fail:
- Confirm internet access.
- Restart ionic serve.
- Confirm proxy configuration is present.

If app does not start:
- Delete node_modules.
- Re-run npm install.
- Re-run ionic serve.

If saved data appears incorrect:
- Use reset action in settings.
- Reload the application.

## 10. Notes for GitHub Wiki
Copy the content of this guide into your repository wiki as your official User Guide page.
If you add new features, update both this file and the wiki page so documentation remains consistent.