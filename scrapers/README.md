# SoccerView Data Scrapers

Multi-source data scrapers for youth soccer rankings.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run Heartland scraper (current season)
python heartland_scraper.py

# Run FULL historical scrape (2002-present)
python heartland_scraper.py --all
```

## Available Scrapers

| Scraper                | Status     | Coverage                         |
| ---------------------- | ---------- | -------------------------------- |
| `heartland_scraper.py` | ✅ Ready   | Kansas City metro (2002-present) |
| `gotsoccer_scraper.py` | ⏳ Next    | National tournaments             |
| `mlsnext_scraper.py`   | 📋 Planned | Elite boys academies             |
| `ecnl_scraper.py`      | 📋 Planned | Elite boys/girls                 |
| `topdrawer_scraper.py` | 📋 Planned | Rankings validation              |

## Heartland Scraper

Scrapes team standings from [Heartland Soccer Association](https://www.heartlandsoccer.net/) - America's Largest Soccer League.

### Usage

```bash
# Current season only
python heartland_scraper.py

# ALL historical data (2002-present) - ~8,000+ team-season records
python heartland_scraper.py --all

# Specific season
python heartland_scraper.py --season 2024_fall

# Specific season and division
python heartland_scraper.py --season 2024_fall --division boys_prem
```

### Output Files

| File                                  | Description                     |
| ------------------------------------- | ------------------------------- |
| `heartland_standings_YYYY_MM_DD.csv`  | All standings in CSV format     |
| `heartland_standings_YYYY_MM_DD.json` | All standings in JSON format    |
| `supabase_teams_YYYY_MM_DD.json`      | Unique teams for team_elo table |
| `supabase_standings_YYYY_MM_DD.json`  | Historical standings data       |

### Divisions

- `boys_prem` - Boys Premier
- `girls_prem` - Girls Premier
- `boys_rec` - Boys Recreational
- `girls_rec` - Girls Recreational

### Age Groups

U-9 through U-19

## Rate Limiting

All scrapers include rate limiting (1 second between requests) to be respectful to source websites.

## License

Part of SoccerView project. For internal use only.
