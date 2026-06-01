# IRWCMS Bill Measurement Auto-Fill

[![CI](https://github.com/kuttykuyy/irwcms/actions/workflows/ci.yml/badge.svg)](https://github.com/kuttykuyy/irwcms/actions/workflows/ci.yml)

A Chrome extension that auto-fills Indian Railways IRWCMS bill measurement forms from Excel / CSV files — saving hours of manual data entry per measurement book.

---

## Features

- **Excel & CSV upload** — supports `.xlsx`, `.xls`, `.csv` with multi-sheet selector
- **Measurement Book (MB)** — fills Particulars, N1, N2, N3, K, L, B, H, Sign row-by-row
- **Variation Statement (VS)** — matches Item No. and fills Proposed Qty automatically
- **Cloud Measurement Builder** — load saved measurements directly without an Excel file
- **Append / Replace mode** — add rows after existing data or fill from row 1
- **5-speed fill control** — from 500ms (stable) to 1ms (instant bulk)
- **Stop button** — abort a running fill at any row
- **Live preview** — see all rows + total quantity before filling
- **5 languages** — English, हिंदी, தமிழ், ಕನ್ನಡ, తెలుగు
- **Guided tour** — built-in onboarding for new users
- **License system** — trial, contractor, department, and railway account tiers

---

## Install

### Chrome Web Store *(recommended)*
> Coming soon — link will be added here

### Load unpacked *(for testing / development)*

1. Clone this repo
   ```bash
   git clone https://github.com/kuttykuyy/irwcms.git
   cd irwcms
   ```
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the **`dist/`** folder

The extension is ready. Click the IRWCMS icon in the toolbar to open the side panel.

---

## Development

### Prerequisites
- Node.js 18+
- npm 9+

### Setup
```bash
npm install
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript → `dist/` (production, minified) |
| `npm run watch` | Compile + watch for changes (source maps included) |
| `npm test` | Run all 46 integration tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check without emitting output |

### Development workflow
```bash
npm run watch          # keep running in one terminal
# Open chrome://extensions → click ↺ to reload after each save
```

---

## Project Structure

```
dist/               ← Compiled extension (load this folder in Chrome)
src/
  types.ts          ← All TypeScript interfaces + MB_FIELD_INDEX
  constants.ts      ← URLs, speed settings, isIrwcmsUrl()
  license.ts        ← Login, verify, activate, deactivate
  fill.ts           ← Fill button orchestration
  preview.ts        ← Data normalization + preview table rendering
  cloud.ts          ← Measurement Builder cloud integration
  ui.ts             ← Status bar, tabs, speed, credits, tour, i18n
  popup.ts          ← Entry point — wires all modules on DOMContentLoaded
content.ts          ← Content script — message bridge to IRWCMS page DOM
tests/
  setup.ts          ← Chrome API mocks
  preview.test.ts   ← normalizeData, formatDecimal (15 tests)
  detection.test.ts ← detectFormType, extractPageInfo (12 tests)
  fill.test.ts      ← VS fill, MB indices, row counting (19 tests)
manifest.json       ← Extension manifest (MV3, HTTPS-only hosts)
popup.html          ← Side panel UI
translations.js     ← i18n strings (EN/HI/TA/KN/TE)
esbuild.config.js   ← Build pipeline (TypeScript → IIFE bundles)
```

### Key design decisions

**Content script as message bridge**
All DOM interaction happens in `content.ts` via `chrome.tabs.sendMessage`. The popup never injects fill logic via `executeScript` — this eliminates duplicate code and makes fill logic testable.

**Named field indices**
```typescript
// Before (magic number)
fillInput(inputs[7], row.H);

// After (named constant)
fillInput(inputs[MB_FIELD_INDEX.H], row.H);
```

**Single source of truth for types**
All interfaces live in `src/types.ts` — imported by both the popup modules and `content.ts`.

---

## Architecture

```
popup.ts (entry)
  ├── license.ts   ←→  irwcms.primerp.in/api/*
  ├── fill.ts      ──→  sendMessage  ──→  content.ts
  ├── preview.ts   (pure: normalise + render)
  ├── cloud.ts     ←→  irwcms.primerp.in/api/measurements
  └── ui.ts        (DOM helpers, tour, i18n)

content.ts (injected into ircep.gov.in)
  ├── fillFormRows()       — MB row-by-row fill
  ├── fillVariationForm()  — VS item-no matching fill
  ├── detectFormType()     — MB vs VS vs none
  ├── extractPageInfo()    — agreement no, email, contractor, measurement no
  └── countExistingRows()  — for append mode
```

---

## Testing

```bash
npm test
```

```
Test Suites: 3 passed
Tests:       46 passed
Time:        ~22s
```

Tests use **Jest + jsdom** with a Chrome API mock. No real browser or network calls.

To add tests, create `tests/yourmodule.test.ts` — it's automatically picked up.

---

## License & Usage

This extension requires a license from [irwcms.primerp.in](https://irwcms.primerp.in).

- **Trial** — free, Measurement Builder fills only
- **Contractor** — paid, Excel upload, locked to your contractor name
- **Department / Railway** — institutional accounts

---

## Contributing

1. Fork → create a feature branch
2. Make changes in `src/` or `content.ts`
3. Run `npm test` — all 46 tests must pass
4. Run `npm run build` — `dist/` must build cleanly
5. Open a pull request — CI runs automatically

Please keep `MB_FIELD_INDEX` updated if IRWCMS adds new form columns, and add a test for any new detection or normalization logic.
