# CLAUDE.md - SoccerView Project Master Reference

> **Version 6.0** | Last Updated: January 28, 2026 | Session 50
>
> This is the lean master reference. Detailed documentation in [docs/](docs/).

---

## Quick Links to Documentation

| Document | Purpose |
|----------|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | V2 database architecture (3-layer design) |
| [docs/DATA_SCRAPING_PLAYBOOK.md](docs/DATA_SCRAPING_PLAYBOOK.md) | How to add new data sources |
| [docs/DATA_EXPANSION_ROADMAP.md](docs/DATA_EXPANSION_ROADMAP.md) | Priority queue for expansion |
| [docs/UI_PATTERNS.md](docs/UI_PATTERNS.md) | Mandatory UI patterns |
| [docs/SESSION_HISTORY.md](docs/SESSION_HISTORY.md) | All past session summaries |
| [docs/_archive/](docs/_archive/) | Completed project documents |

---

## Project Overview

SoccerView is a React Native/Expo app providing national youth soccer rankings:

1. **Official Rankings** (Gold/Amber) - GotSport national rankings
2. **SoccerView Power Rating** (Blue) - Proprietary ELO-based algorithm

### Target Users
- Youth soccer parents seeking team performance insights
- Coaches tracking competitive landscape
- Tournament directors using rankings for seeding

### Competitive Advantage
- Modern dark-themed UI
- Dual ranking system
- AI-powered match predictions
- League Standings feature

---

## Critical Principles

### 1. Nomenclature (ALWAYS USE)

| Term | Definition | Duration |
|------|------------|----------|
| **LEAGUE** | Regular season play | Weeks/months |
| **TOURNAMENT** | Short competition | Weekend (1-3 days) |

**"Events" is BANNED** - Use "leagues" or "tournaments" only.

### 2. Single Source of Truth

```
Scrapers → SoccerView DB → ELO Calculation → App
```

- All teams from ALL sources are first-class entities
- Every team gets SoccerView ELO rating
- 100% link rate target

### 3. V2 Architecture Data Flow

```
Scrapers → staging_games → validationPipeline.js → matches_v2 → app_views → App
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details.

### 4. Team Names Never Truncate

Team names must ALWAYS be fully visible. Cards expand to fit.

```typescript
// ❌ WRONG
<Text numberOfLines={2}>{team.name}</Text>

// ✅ CORRECT
<Text>{team.name}</Text>
```

---

## Quick Reference

### Database Status (V2 - Production)

| Table | Rows | Purpose |
|-------|------|---------|
| `teams_v2` | 137,582 | Team records |
| `matches_v2` | 292,802 | Match results |
| `clubs` | 32,334 | Club organizations |
| `leagues` | 273 | League metadata |
| `tournaments` | 1,492 | Tournament metadata |

### Materialized Views (App Queries)

| View | Purpose |
|------|---------|
| `app_rankings` | Rankings & Teams tabs |
| `app_matches_feed` | Matches tab |
| `app_league_standings` | League standings |
| `app_team_profile` | Team detail |
| `app_upcoming_schedule` | Future games |

### Data Sources

| Source | Status | Output |
|--------|--------|--------|
| GotSport | ✅ Production | staging_games |
| HTGSports | ✅ Production | staging_games |
| Heartland CGI | ✅ Production | staging_games |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile App | React Native + Expo (TypeScript) |
| Backend | Supabase (PostgreSQL) |
| Data Pipeline | Node.js + Puppeteer |
| Automation | GitHub Actions |
| Build | EAS Build |

### Environment Variables

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
DATABASE_URL
```

### Preferred Libraries

| Category | Library |
|----------|---------|
| Charts (standard) | `react-native-gifted-charts` |
| Charts (inverted) | Custom SVG |
| Animations | `react-native-reanimated` |
| Gestures | `react-native-gesture-handler` |
| Navigation | `expo-router` |
| Icons | `@expo/vector-icons` |
| Haptics | `expo-haptics` |

---

## App Structure

### Tab Navigation

| Tab | File | Purpose |
|-----|------|---------|
| Home | `app/(tabs)/index.tsx` | Stats, Latest Matches, Top Teams |
| Rankings | `app/(tabs)/rankings.tsx` | Official/SoccerView rankings |
| Teams | `app/(tabs)/teams.tsx` | Search & browse teams |
| Matches | `app/(tabs)/matches.tsx` | Recent matches |

### Key Components

| Component | File |
|-----------|------|
| MatchCard | `components/MatchCard.tsx` |
| RankChart | `app/team/[id].tsx` |

---

## ELO Methodology

### Season Alignment

| Aspect | Value |
|--------|-------|
| Season Start | August 1 |
| Season End | July 31 |
| K-Factor | 32 |
| Starting ELO | 1500 |

**Why current season only?** GotSport resets annually. Using all-time would make comparisons meaningless.

### Grade Scale

| Grade | ELO Range |
|-------|-----------|
| A+ | 1650+ |
| A/A- | 1550-1649 |
| B+/B/B- | 1475-1549 |
| C+/C/C- | 1400-1474 |
| D+/D/D- | < 1400 |

---

## Key Scripts

### Data Pipeline (V2)

| Script | Purpose |
|--------|---------|
| `validationPipeline.js` | Staging → Production |
| `recalculate_elo_v2.js` | ELO calculation |

### Scrapers (Write to staging_games)

| Script | Source |
|--------|--------|
| `syncActiveEvents.js` | GotSport |
| `scrapeHTGSports.js` | HTGSports |
| `scrapeHeartlandResults.js` | Heartland CGI |

### Archived Scripts

See `scripts/_archive/README.md` for V1 scripts (no longer used).

---

## Operating Rules for Claude

### Core Principles

1. **Claude operates as SME** - Find info independently
2. **GOLD STANDARD ONLY** - Use world-class solutions
3. **Best-in-class libraries** - Never settle for "good enough"
4. **Deep research before claims** - Verify with code/database
5. **Complete file replacements** - Full files, not partial snippets

### Tool Usage

- **Web research:** Use `web_search` directly
- **Database queries:** Use Supabase MCP
- **File operations:** Use filesystem MCP

### Code Management

- Review existing code before rewriting
- Include verification for schema changes
- Maintain separation between dev and production

---

## Development Commands

```bash
# Start development
npx expo start

# Run validation pipeline
node scripts/validationPipeline.js --refresh-views

# Recalculate ELO
node scripts/recalculate_elo_v2.js

# Refresh views only
psql $DATABASE_URL -c "SELECT refresh_app_views();"

# Build for production
eas build --platform ios
eas build --platform android
```

---

## Current Session Status

### Session 50 - V2 Complete (January 28, 2026)

**Accomplished:**
- ✅ V2 architecture fully implemented
- ✅ All scrapers write to staging tables
- ✅ V1 tables archived to `*_deprecated`
- ✅ V1 scripts moved to `scripts/_archive/`
- ✅ Documentation reorganized into docs/ folder

**Data Flow:**
```
Scrapers → staging_games → validationPipeline.js → matches_v2 → app_views → App
```

### Database Architecture

```
Layer 1: Staging (staging_games, staging_teams, staging_events)
    ↓ validationPipeline.js
Layer 2: Production (teams_v2, matches_v2, leagues, tournaments)
    ↓ refresh_app_views()
Layer 3: App Views (app_rankings, app_matches_feed, etc.)
```

### Resume Prompt

When starting a new session:
> "Resume SoccerView. Check current status in CLAUDE.md. Architecture docs in docs/."

---

## File Structure

```
soccerview/
├── app/
│   ├── (tabs)/           # Tab screens
│   ├── team/[id].tsx     # Team detail
│   ├── league/[eventId].tsx  # League detail
│   └── _layout.tsx       # Root layout
├── components/
│   └── MatchCard.tsx     # Shared match card
├── lib/
│   ├── supabase.ts       # Supabase client
│   └── leagues.ts        # League functions
├── scripts/
│   ├── validationPipeline.js  # Main pipeline
│   ├── recalculate_elo_v2.js  # ELO calc
│   ├── migrations/       # DB migrations
│   └── _archive/         # Deprecated scripts
├── docs/
│   ├── ARCHITECTURE.md   # V2 schema
│   ├── DATA_SCRAPING_PLAYBOOK.md
│   ├── DATA_EXPANSION_ROADMAP.md
│   ├── UI_PATTERNS.md
│   ├── SESSION_HISTORY.md
│   └── _archive/         # Old docs
├── CLAUDE.md             # THIS FILE
└── package.json
```

---

## UI Design System

| Element | Color | Hex |
|---------|-------|-----|
| Background | Black | #000000 |
| Card | Dark Gray | #111111 |
| Primary Blue | Blue | #3B82F6 |
| Amber/Gold | Amber | #F59E0B |
| Success | Green | #10B981 |
| Error | Red | #EF4444 |

See [docs/UI_PATTERNS.md](docs/UI_PATTERNS.md) for all patterns.

---

*This document is the master reference for all Claude interactions.*
*Detailed documentation is in the docs/ folder.*
*Update at the end of each session.*
