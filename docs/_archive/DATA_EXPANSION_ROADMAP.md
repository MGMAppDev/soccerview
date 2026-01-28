# SoccerView Data Expansion Roadmap

> **Version 1.1** | Created: January 26, 2026 | Session 44
>
> Strategic guide for adding new data sources post-V1 launch.
> This is a living document - update when discovering new sources or completing integrations.

---

## 🚨 CRITICAL RULES

### Rule 1: NO INDOOR SOCCER OR FUTSAL

> **Indoor soccer and futsal data MUST BE EXCLUDED from SoccerView.**

| Type | Include? | Reason |
|------|----------|--------|
| **Outdoor 11v11** | ✅ YES | Core competitive soccer |
| **Outdoor 9v9** | ✅ YES | Youth developmental (U10-U12) |
| **Outdoor 7v7** | ✅ YES | Youth developmental (U8-U10) |
| **Outdoor 5v5/3v3** | ⚠️ MAYBE | Only if part of sanctioned league |
| **Indoor Soccer** | ❌ NO | Different sport, dilutes data |
| **Futsal** | ❌ NO | Different sport, dilutes data |

**Why this matters:**
- Indoor/futsal have different rules, field sizes, and team compositions
- Mixing data would corrupt ELO ratings and rankings
- Parents searching for outdoor team rankings don't want indoor results
- Most platforms (HTGSports especially) are ~80% futsal - must filter carefully

**When scraping:**
- ALWAYS check event/league names for: "futsal", "indoor", "arena", "winter indoor"
- EXCLUDE any event with these keywords
- When in doubt, check the venue - indoor facilities = exclude

### Rule 2: Last 3 Seasons Only

> **Only scrape data from the last 3 soccer seasons (August 2023 - Present).**

| Season | Date Range | Include? |
|--------|------------|----------|
| **2025-26** (Current) | Aug 2025 - Jul 2026 | ✅ YES |
| **2024-25** | Aug 2024 - Jul 2025 | ✅ YES |
| **2023-24** | Aug 2023 - Jul 2024 | ✅ YES |
| **2022-23 and older** | Before Aug 2023 | ❌ NO |

**Why this matters:**
- Older data doesn't reflect current team quality
- Players age out every year (U13 in 2022 is U16 in 2025)
- Rosters change significantly season to season
- Storage and processing efficiency
- GotSport rankings use current season only

**When scraping:**
- Filter by date: `match_date >= '2023-08-01'`
- Skip historical archives unless specifically needed
- Focus on active/recent leagues and tournaments

### Rule 3: Nomenclature Standards

> **"Events" is BANNED** - Always use specific terminology.

| Term | Definition | Duration | Data Value |
|------|------------|----------|------------|
| **LEAGUE** | Regular season play with standings | Weeks/months (ongoing) | HIGH - consistent weekly data |
| **TOURNAMENT** | Short-term competition brackets | Weekend (1-3 days) | HIGH - concentrated match data |

### Rule 4: Team Name Matching Rules

> **Critical for linking matches to teams correctly.**

| Rule | Example | Action |
|------|---------|--------|
| **Strip age/gender suffix** | "Sporting KC (U15 Boys)" → "Sporting KC" | 92% of team_elo records have suffix that match_results does NOT |
| **Validate year matches** | "Team 2013" should NOT match "Team 2015" | Prefix matching can link wrong teams |
| **Validate gender matches** | Boys team should NOT match Girls team | Even if names are similar |
| **Validate state matches** | "Sporting KC" (KS) ≠ "Sporting" (CA) | Same name, different states |

**Reference:** See `scripts/reconcileRankedTeams.js` lines 204-207 for validation logic.

### Rule 5: ELO Calculation Rules

> **ELO ratings use CURRENT SEASON only (Aug 1, 2025+).**

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Current Season Start** | `2025-08-01` | Update annually in `recalculate_elo_v2.js` |
| **K-Factor** | 32 | Standard ELO adjustment factor |
| **Starting ELO** | 1500 | New teams start here |
| **Season Reset** | August 1 | Aligns with GotSport methodology |

**Why current season only?**
- GotSport resets rankings each season
- Using all-time data creates meaningless Official vs SoccerView comparisons
- Example: Team ranked #3 Official but #349 SoccerView = data scope mismatch

### Rule 6: Research Checklist for New Sources

**ALWAYS investigate and document:**

1. **Does it have LEAGUE match results?** (regular season with scores)
2. **Does it have TOURNAMENT match results?** (weekend competitions with scores)
3. **Does it have SCHEDULES?** (upcoming matches - parents want this!)
4. **Is it OUTDOOR soccer only?** (exclude indoor/futsal - CRITICAL!)
5. **Does it have data from last 3 seasons?** (Aug 2023+ only)
6. **What geographic regions does it cover?**
7. **What age groups/genders?**
8. **Technical access method?** (HTML scraping, API, authentication required?)

### Rule 7: Single Source of Truth Principles

> **From CLAUDE.md - these are FUNDAMENTAL principles.**

| Principle | Implementation |
|-----------|----------------|
| **SoccerView = Master Data Source** | All external data feeds INTO SoccerView; we own the canonical dataset |
| **Capture ALL available data** | Scrapers MUST extract every field available (scores, dates, locations, etc.) |
| **Include team SCHEDULES** | Parents want upcoming matches - scrape future games, not just results ⭐ |
| **Every source = first-class** | Teams from new sources are INSERTED, not force-matched to GotSport |
| **Every team gets ELO** | SoccerView's proprietary rating applies to ALL teams from ALL sources |
| **Automated deduplication** | Nightly pipeline identifies and merges cross-source duplicates |
| **Best data wins** | When merging, keep the most complete/accurate information |
| **100% link rate target** | Every match links to a team (same source or merged) |
| **No data left behind** | ALL scraped data must be integrated - manual processes NOT allowed |

### Rule 8: Data Fields to Capture

> **Every scraper MUST attempt to capture these fields.**

| Field | Required | Purpose |
|-------|----------|---------|
| `home_team_name` | ✅ MUST | Team identification |
| `away_team_name` | ✅ MUST | Team identification |
| `match_date` | ✅ MUST | Temporal filtering |
| `home_score` | ⚠️ SHOULD | ELO calculation requires scores |
| `away_score` | ⚠️ SHOULD | ELO calculation requires scores |
| `event_name` | ⚠️ SHOULD | League/Tournament identification |
| `age_group` | ⚠️ SHOULD | Filtering (U8, U10, U12, etc.) |
| `gender` | ⚠️ SHOULD | Filtering (Boys, Girls) |
| `state` | ⚠️ SHOULD | Regional filtering |
| `source_platform` | ✅ MUST | Data origin tracking |
| `source_match_key` | ✅ MUST | Deduplication |

---

## Data Source Classification Framework

### Source Quality Tiers

| Tier | Criteria | Example |
|------|----------|---------|
| **Tier 1: Gold** | Both leagues AND tournaments, with scores, API or easy scraping | GotSport, HTGSports |
| **Tier 2: Silver** | Either leagues OR tournaments, with scores | SINC Sports, Demosphere |
| **Tier 3: Bronze** | Schedules only (no scores) OR limited coverage | Blue Sombrero calendar |
| **Tier 4: Research** | Needs investigation, access unclear | PlayMetrics, Affinity |

### Data Completeness Checklist

For each source, document:

```
[ ] League Results (with scores)
[ ] League Schedules (upcoming)
[ ] League Standings
[ ] Tournament Results (with scores)
[ ] Tournament Schedules (upcoming)
[ ] Tournament Brackets
[ ] Team Rosters
[ ] Player Stats
```

---

## Platform Inventory

### Currently Integrated (V1)

| Platform | Type | States | Leagues | Tournaments | Status |
|----------|------|--------|---------|-------------|--------|
| **GotSport** | Primary | 50 | ✅ Yes | ✅ Yes | ✅ Production |
| **HTGSports** | Secondary | KS, MO | ✅ 4 | ✅ 43 | ✅ Production |
| **Heartland CGI** | Secondary | KS, MO | ✅ Yes | ❌ No | ✅ Production |

### HTGSports - NATIONWIDE Expansion Opportunity (Session 44 Discovery)

> **MAJOR FINDING:** HTGSports covers **26+ states**, not just Heartland!

#### HTGSports Coverage by Region

| Region | States | Outdoor Soccer Leagues | Outdoor Soccer Tournaments |
|--------|--------|------------------------|---------------------------|
| **Midwest Hub** | KS, MO, IA, NE, SD, WI, MN, IL, MI, IN | 6+ | 30+ |
| **East Coast** | NC, SC, VA, PA, NY, NJ, CT, MA, MD, OH, KY, FL | 3+ | 15+ |
| **West/Southwest** | CA, CO, AZ, TX, ID | 2+ | 5+ |

#### HTGSports Outdoor Soccer Leagues (NOT Currently Scraping)

| League Name | Location | State | Priority |
|-------------|----------|-------|----------|
| Northland 7v7 Soccer League | Kansas City, MO | MO | 🟠 HIGH |
| Collier Soccer League | Bonita Springs, FL | FL | 🟡 MEDIUM |
| Sporting Iowa Premier Games | Grimes, IA | IA | 🔴 CRITICAL |
| Future League | Moberly, MO | MO | 🟡 MEDIUM |
| MID MO MICRO | Boonville, MO | MO | 🟡 MEDIUM |

#### HTGSports Outdoor Soccer Tournaments (NOT Currently Scraping)

| Tournament | Location | State | Priority |
|------------|----------|-------|----------|
| Iowa Rush Fall Cup | Des Moines, IA | IA | 🔴 CRITICAL |
| Iowa Rush Spring Cup | Des Moines, IA | IA | 🔴 CRITICAL |
| Just for Girls Tournament | Des Moines, IA | IA | 🔴 CRITICAL |
| GEA Kickstart (Boys/Girls) | Gretna, NE | NE | 🔴 CRITICAL |
| CSI Omaha | Omaha, NE | NE | 🔴 CRITICAL |
| April Fool's Festival | Bettendorf, IA | IA | 🟠 HIGH |
| Tonka Splash | Minnetonka, MN | MN | 🟠 HIGH |
| Indiana Elite FC Kickoff | Crown Point, IN | IN | 🟠 HIGH |
| Emerald Cup | Pittsburgh, PA | PA | 🟠 HIGH |
| USYF Regional Championships | Multiple | Nationwide | 🟠 HIGH |

#### HTGSports Implementation Plan

**Phase 1: Discovery**
```bash
# Build crawler to find ALL outdoor soccer leagues/tournaments on HTGSports
node scripts/discoverHTGSportsOutdoor.js  # TODO: Create this script
```

**Phase 2: Filter**
- Exclude futsal (indoor) - most HTGSports data is futsal
- Exclude 3v3/5v5 small-sided
- Keep only outdoor 7v7, 9v9, 11v11

**Phase 3: Configure**
- Add discovered IDs to `scripts/scrapeHTGSports.js` CONFIG
- Group by state for targeted scraping

**Phase 4: Scrape**
```bash
node scripts/scrapeHTGSports.js --state IA  # Iowa first (critical gap)
node scripts/scrapeHTGSports.js --state NE  # Nebraska
# etc.
```

**Estimated Data Gain:** 50,000+ matches from 20+ states

---

### Platforms To Integrate (V1.1+)

#### Tier 1: Already Have Access (GotSport)

States using GotSport where we can expand coverage by discovering more leagues/tournaments:
- GA, AL, TN, LA, CO, OK, NH, MN, UT, OR, and most others
- **Strategy**: Continue Phase 1/2 scrapers to discover more leagues and tournaments

#### Tier 2: NEW Platforms to Build Scrapers For

| Platform | States | Website | Est. Teams | Leagues | Tournaments | Technical |
|----------|--------|---------|------------|---------|-------------|-----------|
| **HTGSports** | 26+ states | events.htgsports.net | 10,000+ | ✅ Yes | ✅ Yes | Puppeteer (SPA) |
| **SINC Sports** | NC | sincsports.com | 3,000+ | ⚠️ Research | ⚠️ Research | HTML scraping |
| **Demosphere** | WI, MI, IA, WA | *.demosphere.com | 8,000+ | ✅ Yes | ✅ Yes | HTML scraping |
| **PlayMetrics** | MS, WI, GA | playmetrics.com | 2,000+ | ⚠️ API? | ⚠️ API? | JSON API (paid?) |
| **SportsConnect** | SC | sportsconnect.com | 1,200+ | ⚠️ Research | ⚠️ Research | Stack Sports |
| **Affinity** | WA | affinitysoccer.com | 2,800+ | ⚠️ Research | ⚠️ Research | WA Youth Soccer |

#### Tier 3: Multi-State/National Leagues & Tournaments

| Organization | States | Platform | Teams | Leagues | Tournaments |
|--------------|--------|----------|-------|---------|-------------|
| **EDP Soccer** | NJ, PA, DE, MD, VA, NY, CT, FL, OH | Uses GotSport | 5,000+ | ✅ Yes | ✅ Yes |
| **ECNL/ECNL-RL** | Nationwide | ecnlsoccer.com | 2,000+ | ✅ Yes | ⚠️ Research |
| **Girls Academy** | Nationwide | girlsacademyleague.com | 1,500+ | ✅ Yes | ⚠️ Research |
| **NPL (US Club)** | Nationwide | usclubsoccer.org | 3,000+ | ✅ Yes | ⚠️ Research |
| **USYS National League** | Nationwide | nationaleague.com | 2,000+ | ✅ Yes | ⚠️ Research |
| **Piedmont Conference** | NC, SC, GA, TN | Uses GotSport | 500+ | ✅ Yes | ✅ Yes |
| **Midwest Conference** | IL, WI, MI, MO, IA, KS, NE, ND, SD, MN | Uses GotSport | 800+ | ✅ Yes | ✅ Yes |
| **MLS NEXT** | Nationwide | mlsnext.com | 3,000+ | ✅ Yes | ⚠️ Research |

#### Platform Technical Notes

| Platform | Data Format | Auth Required | Rate Limits | Outdoor Filter Needed |
|----------|-------------|---------------|-------------|----------------------|
| GotSport | HTML/JSON | No | IP-based | No (mostly outdoor) |
| **HTGSports** | HTML (SPA) | No | Light | **YES - 80% is futsal!** |
| **SINC Sports** | HTML | No | Unknown | Research needed |
| Demosphere | HTML | No | Unknown | Research needed |
| PlayMetrics | JSON | Yes | API limits | Research needed |
| SportsConnect | HTML | Varies | Unknown | Research needed |
| EDP Soccer | GotSport | No | Same as GS | No |

#### Priority 1: Critical Coverage Gaps

| Platform | States | Coverage Gap | Est. Outdoor Matches | Leagues | Tournaments |
|----------|--------|--------------|----------------------|---------|-------------|
| **SINC Sports** | NC | 20.4% | 25,000+ | ⚠️ Research | ⚠️ Research |
| **Piedmont Conference** | SC, NC, GA, TN | 17-26% | 15,000+ | ✅ Yes | ✅ Yes |
| **SportsConnect** | SC | 17.3% | 8,000+ | ⚠️ Research | ⚠️ Research |

#### Priority 2: Regional Expansion

| Platform | States | Est. Outdoor Matches | Leagues | Tournaments |
|----------|--------|----------------------|---------|-------------|
| **Demosphere** | WI, MI, IA, WA | 30,000+ | ✅ Yes | ✅ Yes |
| **PlayMetrics** | MS, WI, GA | 10,000+ | ⚠️ API? | ⚠️ API? |
| **Affinity** | WA | 15,000+ | ⚠️ Research | ⚠️ Research |

#### Priority 3: National Elite Leagues

| Platform | Coverage | Est. Outdoor Matches | Leagues | Tournaments |
|----------|----------|----------------------|---------|-------------|
| **EDP Soccer** | Northeast + FL | 20,000+ | ✅ Yes (GotSport) | ✅ Yes |
| **ECNL** | Nationwide | 15,000+ | ✅ Yes | ⚠️ Research |
| **Girls Academy** | Nationwide | 10,000+ | ✅ Yes | ⚠️ Research |
| **MLS NEXT** | Nationwide | 20,000+ | ✅ Yes | ⚠️ Research |

---

## State Coverage Analysis

### Critical Gaps (< 30% coverage)

| State | Current | Teams | Primary Issue | Solution |
|-------|---------|-------|---------------|----------|
| **SC** | 17.3% | 1,205 | SportsConnect platform | Build scraper |
| **NC** | 20.4% | 3,172 | SINC Sports platform | Build scraper |
| **GA** | 26.0% | 3,030 | League data missing | Scrape GA Soccer site |
| **NE** | 26.3% | 911 | Custom website | HTGSports expansion |
| **MS** | 27.5% | 655 | PlayMetrics platform | API integration |

### High Priority (30-50% coverage)

| State | Current | Teams | Solution |
|-------|---------|-------|----------|
| **AL** | 33.9% | 992 | More GotSport events |
| **TN** | 40.9% | 1,762 | Piedmont Conference |
| **LA** | 43.2% | 711 | More GotSport events |
| **WA** | 43.7% | 2,815 | Affinity/Demosphere |
| **CO** | 44.4% | 2,119 | More GotSport events |
| **WI** | 45.1% | 1,728 | HTGSports + Demosphere |
| **OK** | 45.9% | 894 | More GotSport events |
| **MI** | 50.1% | 3,355 | HTGSports + Demosphere |

### New Opportunities (HTGSports Discovery)

| State | Current | HTGSports Data Available | Priority |
|-------|---------|-------------------------|----------|
| **IA** | Unknown | 12+ tournaments, 3+ leagues | 🔴 CRITICAL |
| **SD** | Unknown | 10+ tournaments, 1+ leagues | 🟠 HIGH |
| **MN** | Unknown | 5+ tournaments, 2+ leagues | 🟠 HIGH |
| **IN** | Unknown | 2+ tournaments | 🟡 MEDIUM |
| **PA** | Unknown | Emerald Cup + others | 🟡 MEDIUM |

---

## Technical Integration Patterns

### Pattern A: HTML Scraping (Puppeteer)

**Use when:** JavaScript-rendered pages, SPAs, dynamic content

```javascript
// Example: HTGSports, Heartland Calendar
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto(url);
await page.waitForSelector('.match-table');
// Extract data...
```

**Scripts using this pattern:**
- `scrapeHTGSports.js`
- `scrapeHeartlandLeague.js`

### Pattern B: HTML Scraping (Cheerio)

**Use when:** Static HTML, server-rendered pages, CGI endpoints

```javascript
// Example: Heartland Results CGI
import * as cheerio from 'cheerio';

const response = await fetch(url);
const html = await response.text();
const $ = cheerio.load(html);
$('table tr').each((i, row) => {
  // Extract data...
});
```

**Scripts using this pattern:**
- `scrapeHeartlandResults.js`
- `syncActiveEvents.js` (GotSport)

### Pattern C: API Integration

**Use when:** Platform provides JSON API

```javascript
// Example: Potential PlayMetrics
const response = await fetch(apiUrl, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const data = await response.json();
```

**Scripts using this pattern:**
- None yet (PlayMetrics is a candidate)

### Pattern D: ICS/WebCal Parsing

**Use when:** Calendar feeds available

```javascript
// Example: Blue Sombrero calendars
import ICAL from 'ical.js';

const icsData = await fetch(webcalUrl.replace('webcal://', 'https://'));
const parsed = ICAL.parse(icsData);
// Extract events...
```

**Scripts using this pattern:**
- `scrapeHeartlandICS.js`

---

## Data Pipeline Integration

### Standard Integration Flow

```
1. SCRAPE → Raw data from source
2. NORMALIZE → Map to SoccerView schema
3. DEDUPLICATE → source_match_key prevents duplicates
4. INSERT → Upsert to match_results table
5. INTEGRATE → Create teams from match data (integrateHeartlandTeams.js pattern)
6. LINK → Connect matches to teams (linkTeams.js)
7. CALCULATE → Update ELO ratings (recalculate_elo_v2.js)
8. SYNC → Update match counts (syncMatchCounts.js)
```

### Required Fields for match_results

| Field | Required | Source |
|-------|----------|--------|
| `home_team_name` | ✅ Yes | Scraped |
| `away_team_name` | ✅ Yes | Scraped |
| `match_date` | ✅ Yes | Scraped |
| `home_score` | ⚠️ Preferred | Scraped (if available) |
| `away_score` | ⚠️ Preferred | Scraped (if available) |
| `source_platform` | ✅ Yes | Set by scraper |
| `source_match_key` | ✅ Yes | Generated for dedup |
| `event_name` | ⚠️ Preferred | Scraped |
| `age_group` | ⚠️ Preferred | Scraped or inferred |
| `gender` | ⚠️ Preferred | Scraped or inferred |

### source_platform Values

| Value | Description |
|-------|-------------|
| `gotsport` | GotSport tournaments/leagues |
| `htgsports` | HTGSports tournaments/leagues |
| `heartland` | Heartland League CGI results |
| `sincsports` | SINC Sports (future) |
| `demosphere` | Demosphere (future) |
| `playmetrics` | PlayMetrics (future) |

---

## Scraper Development Checklist

When building a new scraper:

```
CRITICAL FILTERS (Must implement):
[ ] Filter: OUTDOOR ONLY - exclude futsal, indoor, arena keywords
[ ] Filter: LAST 3 SEASONS ONLY - match_date >= '2023-08-01'
[ ] Filter: SOCCER ONLY - exclude other sports if platform is multi-sport

Research & Documentation:
[ ] Research: Identify all LEAGUES available (regular season)
[ ] Research: Identify all TOURNAMENTS available (weekend competitions)
[ ] Document: Add platform to DATA_EXPANSION_ROADMAP.md with full details

Development:
[ ] Prototype: Test scraping on 1-2 sample pages
[ ] Handle pagination: Most platforms paginate results
[ ] Handle rate limits: Add delays between requests
[ ] Generate source_match_key: Unique identifier for deduplication
[ ] Set source_platform: Consistent identifier

Testing:
[ ] Verify: All matches are OUTDOOR (spot check 20 random)
[ ] Verify: All matches are within 3 seasons (no dates before Aug 2023)
[ ] Test deduplication: Run twice, verify no duplicates

Deployment:
[ ] Add to daily sync: Update daily-data-sync.yml workflow
[ ] Update CLAUDE.md: Add to production sources list
```

---

## Success Metrics

### V1.1 Goals

| Metric | Current (V1) | Target (V1.1) |
|--------|--------------|---------------|
| Total Matches | 470,135 | 550,000+ |
| States > 50% coverage | ~35 | 45+ |
| Data Sources | 3 | 5+ |
| HTGSports States | 2 (KS, MO) | 10+ |

### Priority Order for Maximum Impact

1. **HTGSports Nationwide Expansion** - Already have scraper, just need more IDs
2. **SINC Sports (NC)** - 3,172 teams at 20.4% = critical gap
3. **Piedmont Conference** - Multi-state impact (SC, NC, GA, TN)
4. **Demosphere** - Single scraper covers WI, MI, IA, WA

---

## References

- [HTGSports Events](https://www.htgsports.net/Home/Events)
- [HTGSports Tournament Center](https://htgsports.net/ttc/)
- [SINC Sports](https://sincsports.com)
- [Demosphere](https://demosphere.com)
- [GotSport](https://gotsport.com)
- [PlayMetrics](https://playmetrics.com)

---

*Last Updated: January 26, 2026 - Session 44*
