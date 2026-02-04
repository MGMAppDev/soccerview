# SoccerView Data Expansion Roadmap

> **Version 2.5** | Updated: February 3, 2026 | V2 Architecture + Session 84 (Premier-Only Policy)
>
> Strategic guide for adding new data sources using the V2 three-layer architecture.
> **Session 57:** Adding a new source now takes ~1-2 hours (adapter config only) instead of ~1-2 days (custom script).
>
> **⚠️ CRITICAL (Session 84): All new data sources MUST be PREMIER/COMPETITIVE level only.**
> Recreational, community, and development leagues are EXCLUDED from SoccerView.

---

## Data Integrity Status (Session 56 - COMPLETE)

### Match-Event Linkage - Final State

| Category | Before | After | Method |
|----------|--------|-------|--------|
| Total unlinked | 17,347 | **~5,789** | 67% fixed |
| HTGSports | 2,228 | **0** | ✅ Pattern matching |
| Heartland | 48 | **0** | ✅ Pattern matching |
| GotSport legacy | 15,071 | **~5,789** | V1 archive + inference |
| Garbage (2027+) | 51 | **0** | ✅ Deleted |

### Self-Healing Pipeline (NEW)

Orphaned matches now shrink automatically each night:

```
Nightly Pipeline:
  Phase 1:   Scrape new data → staging_games
  Phase 2:   Validate → matches_v2 (with linkage)
  Phase 2.5: inferEventLinkage.js → Links orphans by team patterns  ← NEW
  Phase 3:   Recalculate ELO
  Phase 4:   Refresh views
```

**How it works:** If Team A and Team B both play in "Kansas Premier League", and they have an orphaned match within that date range, the script infers that match belongs to Kansas Premier League.

**Initial run:** 1,155 matches linked. **Ongoing:** Improves each night.

### Maintenance Scripts

| Script | Purpose | Schedule |
|--------|---------|----------|
| `ensureViewIndexes.js` | **NIGHTLY** Self-healing index maintenance (Session 69) | Automatic |
| `inferEventLinkage.js` | **NIGHTLY** Self-healing linkage | Automatic |
| `linkUnlinkedMatches.js` | Link via source_match_key | On-demand |
| `linkByEventPattern.js` | Link by event ID pattern | On-demand |
| `linkFromV1Archive.js` | Link via V1 archived data | One-time |
| `cleanupGarbageMatches.js` | Delete invalid matches | On-demand |
| `completeBirthYearCleanup.js` | Fix team birth_year mismatches | On-demand |

### Universal Framework Scripts (Session 57)

| Script | Purpose |
|--------|---------|
| `scripts/universal/coreScraper.js` | Core scraping engine (841 lines) |
| `scripts/adapters/gotsport.js` | GotSport adapter |
| `scripts/adapters/htgsports.js` | HTGSports adapter (Puppeteer) |
| `scripts/adapters/heartland.js` | Heartland adapter |
| `scripts/adapters/_template.js` | Template for new sources |

---

## Critical Rules

### Rule 1: PREMIER-ONLY - NO Recreational or Indoor

| Type | Include? | Reason |
|------|----------|--------|
| **Premier/Competitive 11v11** | ✅ YES | Core competitive soccer |
| **Premier/Competitive 9v9** | ✅ YES | Youth competitive |
| **Premier/Competitive 7v7** | ✅ YES | Youth competitive |
| **Recreational leagues** | ❌ NO | Dilutes rankings (Session 84) |
| **Community programs** | ❌ NO | Not competitive level |
| **Development/Rec** | ❌ NO | Not premier level |
| **Indoor Soccer** | ❌ NO | Different sport |
| **Futsal** | ❌ NO | Different sport |

**Session 84:** Recreational teams were appearing in top 10 SoccerView rankings despite not competing at premier level. This dilutes the value proposition for users seeking competitive team rankings.

### Rule 2: Last 3 Seasons Only

| Season | Date Range | Include? |
|--------|------------|----------|
| 2025-26 (Current) | Aug 2025 - Jul 2026 | ✅ YES |
| 2024-25 | Aug 2024 - Jul 2025 | ✅ YES |
| 2023-24 | Aug 2023 - Jul 2024 | ✅ YES |
| Older | Before Aug 2023 | ❌ NO |

### Rule 3: Nomenclature

| Term | Definition | Duration |
|------|------------|----------|
| **LEAGUE** | Regular season play with standings | Weeks/months |
| **TOURNAMENT** | Short-term competition brackets | Weekend (1-3 days) |

**"Events" is BANNED** - Always use specific terminology.

### Rule 4: V2 Architecture

All new scrapers MUST follow V2 architecture:

```
Scraper → staging_games → validationPipeline.js → matches_v2 → app_views
```

**See:** [docs/DATA_SCRAPING_PLAYBOOK.md](DATA_SCRAPING_PLAYBOOK.md)

---

## Currently Integrated Sources

| Platform | Type | States | Status |
|----------|------|--------|--------|
| **GotSport** | Primary | 50 | ✅ Production |
| **HTGSports** | Secondary | KS, MO | ✅ Production |
| **Heartland CGI** | Secondary | KS, MO | ✅ Production (V2) |

---

## Priority Queue

### Tier 1: Critical Gap States (< 30% coverage)

| Priority | Source | States | Coverage | Est. Matches |
|----------|--------|--------|----------|--------------|
| 1 | **HTGSports Expansion** | 26+ states | Various | 50,000+ |
| 2 | **SINC Sports** | NC | 20.4% | 25,000+ |
| 3 | **SportsConnect** | SC | 17.3% | 8,000+ |
| 4 | **Nebraska YSL** | NE | 26.3% | 5,000+ |

### Tier 2: Regional Expansion

| Priority | Source | States | Est. Matches |
|----------|--------|--------|--------------|
| 5 | **EDP Soccer** | NJ,PA,DE,MD,VA,NY,CT,FL,OH | 30,000+ |
| 6 | **Demosphere** | WI,MI,IA,WA | 20,000+ |
| 7 | **GotSport expansion** | GA,AL,TN | 20,000+ |

### Tier 3: Elite Leagues

| Priority | Source | Coverage | Est. Matches |
|----------|--------|----------|--------------|
| 8 | **ECNL** | Nationwide | 15,000+ |
| 9 | **MLS Next** | Nationwide | 20,000+ |
| 10 | **Girls Academy** | Nationwide | 10,000+ |

---

## HTGSports Nationwide Opportunity

### Discovery (Session 44)

HTGSports covers **26+ states**, not just Heartland!

| Region | States |
|--------|--------|
| **Midwest** | KS, MO, IA, NE, SD, WI, MN, IL, MI, IN |
| **East** | NC, SC, VA, PA, NY, NJ, CT, MA, MD, OH, KY, FL |
| **West** | CA, CO, AZ, TX, ID |

### Known Outdoor Soccer Events (Not Yet Scraped)

**Leagues:**
- Northland 7v7 Soccer League (MO)
- Sporting Iowa Premier Games (IA)
- Collier Soccer League (FL)

**Tournaments:**
- Iowa Rush Fall/Spring Cup (IA)
- GEA Kickstart (NE)
- April Fool's Festival (IA)
- Tonka Splash (MN)
- Indiana Elite FC Kickoff (IN)
- Emerald Cup (PA)

### Implementation (Using Universal Framework)

```bash
# 1. Discover all outdoor soccer events
node scripts/discoverHTGSportsOutdoor.js  # TODO: Create

# 2. Add event IDs to adapter config
# Edit scripts/adapters/htgsports.js activeEvents array

# 3. Run Universal Framework scraper
node scripts/universal/coreScraper.js --adapter htgsports --active

# 4. Validate and refresh
node scripts/daily/validationPipeline.js --refresh-views
```

---

## Platform Technical Notes

| Platform | Technology | Auth | Universal Adapter | Status |
|----------|------------|------|-------------------|--------|
| **GotSport** | HTML/JSON | No | ✅ `gotsport.js` | Production |
| **HTGSports** | Angular SPA | No | ✅ `htgsports.js` | Production |
| **Heartland** | CGI | No | ✅ `heartland.js` | Production |
| **SINC Sports** | ASP.NET | No | ❌ Not built | ~2 hours to add |
| **SportsConnect** | Stack Sports | No | ❌ Not built | ~2 hours to add |
| **EDP Soccer** | Uses GotSport | No | Use GotSport adapter | — |
| **Demosphere** | HTML | No | ❌ Not built | ~2 hours to add |

**Session 57 Impact:** New sources now take ~1-2 hours to add (adapter config only) instead of ~1-2 days (custom script).

---

## State Coverage Gaps

### Critical (< 30%)

| State | Coverage | Teams | Solution |
|-------|----------|-------|----------|
| **SC** | 17.3% | 1,205 | SportsConnect |
| **NC** | 20.4% | 3,172 | SINC Sports |
| **GA** | 26.0% | 3,030 | More GotSport |
| **NE** | 26.3% | 911 | HTGSports |
| **MS** | 27.5% | 655 | PlayMetrics |

### High Priority (30-50%)

| State | Coverage | Teams | Solution |
|-------|----------|-------|----------|
| **AL** | 33.9% | 992 | More GotSport |
| **TN** | 40.9% | 1,762 | Piedmont Conf |
| **LA** | 43.2% | 711 | More GotSport |
| **WA** | 43.7% | 2,815 | Demosphere |
| **CO** | 44.4% | 2,119 | More GotSport |
| **WI** | 45.1% | 1,728 | HTGSports |

---

## New Source Development (Session 57)

### PREFERRED: Universal Framework Adapter

**Adding a new source is now a ~50 line config file.**

```bash
# 1. Copy template
cp scripts/adapters/_template.js scripts/adapters/newsource.js

# 2. Configure adapter (~50 lines):
#    - platform: unique name
#    - technology: "cheerio" | "puppeteer" | "api"
#    - baseUrl: source URL
#    - selectors: CSS selectors for match data
#    - rateLimit: delay between requests
#    - generateMatchKey: unique key function

# 3. Test
node scripts/universal/coreScraper.js --adapter newsource --event 12345 --dry-run

# 4. Run
node scripts/universal/coreScraper.js --adapter newsource --active
```

### Legacy: Custom Scraper (Only if Universal Framework doesn't fit)

Every custom scraper MUST:

1. **Write to staging tables** (NOT production)
2. **Set source_platform** on every record
3. **Generate source_match_key** for deduplication
4. **Preserve raw_data** in JSONB column
5. **Register events** in staging_events
6. **Handle outdoor filter** (NO futsal)
7. **Respect date limits** (Aug 2023+)

### Template

See [docs/DATA_SCRAPING_PLAYBOOK.md](DATA_SCRAPING_PLAYBOOK.md) for adapter template and legacy scraper template.

### Checklist

```markdown
## New Scraper Checklist

### Pre-Development
- [ ] Source identified: _____________
- [ ] Data type: [ ] League  [ ] Tournament  [ ] Both
- [ ] Access method: [ ] HTML  [ ] API  [ ] ICS
- [ ] OUTDOOR only confirmed (no futsal)
- [ ] Date range: Aug 2023+

### Development
- [ ] Scraper writes to staging_games
- [ ] source_platform set correctly
- [ ] source_match_key generated
- [ ] raw_data preserved
- [ ] Events registered in staging_events
- [ ] Rate limiting implemented
- [ ] Checkpoint/resume capability

### Testing
- [ ] Single event test successful
- [ ] Expected vs actual match count matches
- [ ] All fields populated
- [ ] No futsal/indoor data

### Integration
- [ ] validationPipeline.js processes data
- [ ] Data appears in matches_v2
- [ ] Views refreshed
- [ ] App displays new data
```

---

## Success Metrics

### V1.1 Goals

| Metric | Current | Target |
|--------|---------|--------|
| Total Matches | 470,000 | 550,000+ |
| States > 50% | ~35 | 45+ |
| Data Sources | 3 | 5+ |
| HTGSports States | 2 | 10+ |

### Impact by Priority

| Action | Est. New Matches | Impact |
|--------|------------------|--------|
| HTGSports expansion | 50,000+ | Midwest coverage |
| SINC Sports (NC) | 25,000+ | Critical gap |
| EDP Soccer | 20,000+ | Northeast |
| Demosphere | 20,000+ | WI/MI/IA/WA |

---

## References

- [V2 Architecture](ARCHITECTURE.md)
- [Data Scraping Playbook](DATA_SCRAPING_PLAYBOOK.md)
- [UI Patterns](UI_PATTERNS.md)
- [Session History](SESSION_HISTORY.md)

---

*Updated for V2 three-layer architecture with Universal Scraper Framework (Session 57).*
*New sources: Use adapter config (~50 lines, ~1-2 hours) instead of custom script.*
