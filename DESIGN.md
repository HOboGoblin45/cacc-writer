# DESIGN.md — Appraisal Agent Design System

## For Google Stitch / React Frontend Generation

### Brand
- **Product:** Appraisal Agent
- **Company:** Cresci Appraisal & Consulting Company
- **Tagline:** AI-powered narrative drafting for appraisers
- **Logo:** "AA" mark in gold on dark background

### Color Palette
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#0d1117` | Page background |
| `--bg-elevated` | `#11161d` | Card backgrounds |
| `--bg-surface` | `#161b22` | Elevated surfaces |
| `--text` | `#e6edf3` | Primary text |
| `--muted` | `#8b949e` | Secondary text |
| `--accent` | `#e2b714` | Brand gold — CTAs, highlights |
| `--accent-soft` | `rgba(226,183,20,0.14)` | Accent backgrounds |
| `--success` | `#3fb950` | Success states |
| `--danger` | `#f85149` | Errors, alerts |
| `--info` | `#58a6ff` | Informational |
| `--line` | `rgba(230,237,243,0.09)` | Borders |

### Typography
- **Font:** Inter (Google Fonts)
- **Weights:** 400, 500, 600, 700, 800, 900
- **Scale:** 
  - Display: 2.4rem / 900 weight
  - H1: 1.6rem / 800
  - H2: 1.2rem / 700
  - Body: 15px / 400
  - Caption: 0.82rem / 500
  - Label: 0.78rem / 600 / uppercase / letter-spacing 0.05em

### Spacing
- Base unit: 4px
- Card padding: 24px
- Section gap: 32px
- Grid gap: 16px

### Border Radius
- Cards: 16px–24px
- Buttons: 999px (pill)
- Inputs: 12px
- Tags: 999px

### Components

#### Cards
- Border: 1px solid `--line`
- Background: `--bg-elevated`
- Hover: border-color transitions to accent-soft, translateY(-2px)
- Shadow: subtle on elevated (box-shadow: 0 24px 80px rgba(0,0,0,0.35))

#### Buttons
- **Primary:** gradient(135deg, #e2b714, #f5d54f), color #111, pill shape
- **Outline:** transparent bg, 1px solid --line, hover → accent border
- **Danger:** transparent, border + text in --danger
- **Small:** 8px 16px padding, 0.82rem font

#### Stat Cards
- Label: uppercase, muted, 0.78rem
- Value: 1.8rem, 800 weight
- Sub: muted, 0.82rem

#### Navigation
- Top bar: --bg-elevated, 1px bottom border
- Brand mark: 36px square, rounded-10px, gold gradient
- Active tab: accent-soft background with accent border

### Pages to Generate in Stitch

1. **Landing** (`/landing`) — Hero + features grid + pricing cards + CTA
2. **Login** (`/login`) — Tab-based sign in / register form
3. **Dashboard** (`/dashboard`) — Stats row, voice training progress, recent cases, quick actions
4. **Case Workspace** (`/case/:id`) — 5-step wizard: Import → Extract → Generate → Review → Export
5. **Admin** (`/admin`) — Tab panels: System, Users, Billing, AI Config
6. **Analytics** (`/analytics`) — Revenue charts, volume charts, AMC breakdown, projections
7. **Schedule** (`/schedule`) — Calendar view with inspection cards, route map
8. **Settings** (`/settings`) — Profile, AI provider, templates, AMC connections, USPS config
9. **Invoice List** (`/invoices`) — Table with status badges, outstanding total
10. **Client Portal** (`/portal/:token`) — Read-only status timeline, download buttons

### API Base
All API calls to: `{origin}/api/...`
Auth: Bearer token in localStorage (`aa-token`)
User data: localStorage (`aa-user`)

### Key Interactions
- **One-click generate:** POST `/api/cases/:id/batch/generate` → show SSE progress
- **Photo upload:** drag-and-drop + mobile camera → POST with GPS metadata
- **Export:** dropdown with format options (UAD 3.6, PDF, ZIP, MISMO)
- **Real-time:** SSE stream at `/api/collab/stream` for presence + updates

### Dark Theme
This is a dark-mode-first application. All designs should use the dark palette above. No light mode needed initially.

### Responsive
- Desktop-first, responsive down to 768px
- Mobile: hide secondary nav items, stack grids
- Touch-friendly: 44px minimum tap targets

### Accessibility
- Focus-visible rings on all interactive elements
- Semantic HTML
- ARIA labels on icon-only buttons
- Color contrast: WCAG AA minimum
