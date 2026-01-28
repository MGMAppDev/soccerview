# SoccerView Data Expansion Roadmap

> **Version 2.0** | Updated: January 28, 2026 | V2 Architecture
>
> Strategic guide for adding new data sources using the V2 three-layer architecture.

---

## Critical Rules

### Rule 1: NO Indoor Soccer or Futsal

| Type | Include? | Reason |
|------|----------|--------|
| **Outdoor 11v11** | ✅ YES | Core competitive soccer |
| **Outdoor 9v9** | ✅ YES | Youth developmental |
| **Outdoor 7v7** | ✅ YES | Youth developmental |
| **Indoor Soccer** | ❌ NO | Different sport |
| **Futsal** | ❌ NO | Different sport |

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

### Implementation

```bash
# 1. Discover all outdoor soccer events
node scripts/discoverHTGSportsOutdoor.js  # TODO: Create

# 2. Add event IDs to scraper config
# Edit scripts/scrapeHTGSports.js CONFIG.EVENT_IDS

# 3. Run scraper (writes to staging_games)
node scripts/scrapeHTGSports.js

# 4. Validate and refresh
node scripts/validationPipeline.js --refresh-views
```

---

## Platform Technical Notes

| Platform | Technology | Auth | V2 Scraper |
|----------|------------|------|------------|
| **GotSport** | HTML/JSON | No | ⚠️ Needs update |
| **HTGSports** | Angular SPA | No | ⚠️ Needs update |
| **SINC Sports** | ASP.NET | No | ❌ Not built |
| **SportsConnect** | Stack Sports | No | ❌ Not built |
| **EDP Soccer** | Uses GotSport | No | Use GotSport |
| **Demosphere** | HTML | No | ❌ Not built |

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

## New Scraper Development

### V2 Requirements

Every new scraper MUST:

1. **Write to staging tables** (NOT production)
2. **Set source_platform** on every record
3. **Generate source_match_key** for deduplication
4. **Preserve raw_data** in JSONB column
5. **Register events** in staging_events
6. **Handle outdoor filter** (NO futsal)
7. **Respect date limits** (Aug 2023+)

### Template

See [docs/DATA_SCRAPING_PLAYBOOK.md](DATA_SCRAPING_PLAYBOOK.md) for V2 scraper template.

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

*Updated for V2 three-layer architecture.*
*All new sources must follow V2 patterns.*
