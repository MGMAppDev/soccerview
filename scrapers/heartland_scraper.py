#!/usr/bin/env python3
"""
Heartland Soccer Association Data Scraper (v3 - BeautifulSoup HTML Parser)
==========================================================================
Scrapes team standings from heartlandsoccer.net using proper HTML parsing.

Usage:
    python heartland_scraper.py                           # Current season only
    python heartland_scraper.py --all                     # ALL historical data
    python heartland_scraper.py --season 2024_fall        # Specific season
    python heartland_scraper.py --debug                   # Save raw HTML for inspection
"""

import requests
from bs4 import BeautifulSoup
import re
import json
import time
import argparse
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple
from dataclasses import dataclass, asdict
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

BASE_URL = "https://www.heartlandsoccer.net"
ARCHIVES_PATH = "/reports/seasoninfo/archives/standings"

ALL_SEASONS = [
    # Fall seasons (most recent first)
    "2025_fall", "2024_fall", "2023_fall", "2022_fall", "2021_fall", "2020_fall",
    "2019_fall", "2018_fall", "2017_fall", "2016_fall", "2015_fall",
    "2014_fall", "2013_fall", "2012_fall", "2011_fall", "2010_fall",
    "2009_fall", "2008_fall", "2007_fall", "2006_fall", "2005_fall",
    "2004_fall", "2003_fall", "2002_fall",
    # Spring seasons (most recent first)
    "2026_spring", "2025_spring", "2024_spring", "2023_spring", "2022_spring", "2021_spring",
    "2019_spring", "2018_spring", "2017_spring", "2016_spring", "2015_spring",
    "2014_spring", "2013_spring", "2012_spring", "2011_spring", "2010_spring",
    "2009_spring", "2008_spring", "2007_spring", "2005_spring", "2004_spring",
    "2003_spring"
]

def get_seasons_for_years(years: int) -> List[str]:
    """
    Get seasons for the last N years (fall + spring per year).
    
    CURRENT DATE: January 2026
    Current academic year is 2025-26 (Fall 2025 + Spring 2026)
    
    Mapping:
      Year 1 (current):  2025_fall + 2026_spring = "2025-26"
      Year 2 (last):     2024_fall + 2025_spring = "2024-25"
      Year 3 (2 ago):    2023_fall + 2024_spring = "2023-24"
      Year 4 (3 ago):    2022_fall + 2023_spring = "2022-23"
    """
    season_map = {
        1: ["2025_fall", "2026_spring"],  # Current: 2025-26
        2: ["2024_fall", "2025_spring"],  # Last year: 2024-25
        3: ["2023_fall", "2024_spring"],  # 2 years ago: 2023-24
        4: ["2022_fall", "2023_spring"],  # 3 years ago: 2022-23
    }
    
    seasons = []
    for y in range(1, min(years + 1, 5)):
        seasons.extend(season_map.get(y, []))
    
    # Filter to only seasons that actually exist on the website
    return [s for s in seasons if s in ALL_SEASONS]

# Default to 3 years of data
SEASONS = get_seasons_for_years(3)

def get_season_code(season: str) -> str:
    """Convert season string to academic year code (e.g., '2024_fall' -> '2024-25')"""
    parts = season.split('_')
    if len(parts) != 2:
        return season
    year = int(parts[0])
    term = parts[1]
    if term == 'fall':
        return f"{year}-{str(year + 1)[-2:]}"  # 2024_fall -> "2024-25"
    else:  # spring
        return f"{year - 1}-{str(year)[-2:]}"  # 2025_spring -> "2024-25"

DIVISIONS = ["boys_prem", "girls_prem", "boys_rec", "girls_rec"]
REQUEST_DELAY = 1.0

# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class TeamStanding:
    team_number: str
    team_name: str
    wins: int
    losses: int
    ties: int
    goals_for: int
    goals_against: int
    red_cards: int
    points: int
    season: str
    division: str
    age_group: str
    subdivision: str
    gender: str
    
    @property
    def matches_played(self) -> int:
        return self.wins + self.losses + self.ties


# ============================================================================
# SCRAPER CLASS
# ============================================================================

class HeartlandScraper:
    def __init__(self, output_dir: str = "./heartland_data", debug: bool = False):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        })
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.all_teams: List[TeamStanding] = []
        self.debug = debug
        
    def _make_request(self, url: str) -> Optional[str]:
        try:
            time.sleep(REQUEST_DELAY)
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            logger.error(f"Request failed for {url}: {e}")
            return None
    
    def _parse_gender(self, division: str) -> str:
        if division.startswith("boys"):
            return "Boys"
        elif division.startswith("girls"):
            return "Girls"
        return "Unknown"
    
    def _normalize_team_name(self, name: str) -> str:
        name = ' '.join(name.split())
        return name.strip()
    
    def _parse_html_tables(self, html: str, season: str, division: str) -> List[TeamStanding]:
        """Parse HTML tables using BeautifulSoup"""
        teams = []
        gender = self._parse_gender(division)
        soup = BeautifulSoup(html, 'html.parser')
        
        # Save debug HTML if requested
        if self.debug:
            debug_file = self.output_dir / f"debug_{season}_{division}.html"
            with open(debug_file, 'w', encoding='utf-8') as f:
                f.write(html)
            logger.info(f"Saved debug HTML: {debug_file}")
        
        current_age_group = "Unknown"
        current_subdivision = "Unknown"
        
        # Find all elements - headers and tables
        # Look for h4, h3, h2 headers that contain age group info
        for element in soup.find_all(['h2', 'h3', 'h4', 'table', 'p', 'b', 'strong']):
            tag_name = element.name
            text = element.get_text(strip=True)
            
            # Check if this is a subdivision header (contains U-XX pattern)
            if tag_name in ['h2', 'h3', 'h4', 'p', 'b', 'strong']:
                age_match = re.search(r'U-?(\d+)', text, re.IGNORECASE)
                if age_match and ('Subdivision' in text or 'Division' in text or 'Premier' in text or 'Recreational' in text):
                    current_age_group = f"U{age_match.group(1)}"
                    current_subdivision = text
                    continue
            
            # Parse table
            if tag_name == 'table':
                rows = element.find_all('tr')
                
                for row in rows:
                    cells = row.find_all(['td', 'th'])
                    
                    # Skip rows with too few cells or header rows
                    if len(cells) < 8:
                        continue
                    
                    # Get cell texts
                    cell_texts = [cell.get_text(strip=True) for cell in cells]
                    
                    # Skip header rows
                    first_cell = cell_texts[0].lower()
                    if first_cell in ['#', 'team', 'number', ''] or 'subdivision' in first_cell:
                        continue
                    if 'win' in first_cell or 'lose' in first_cell:
                        continue
                    
                    try:
                        # First cell: team number + name OR just name
                        team_info = cell_texts[0]
                        
                        # Try to extract team number (4 chars at start)
                        team_num_match = re.match(r'^([0-9A-Za-z]{4})\s+(.+)$', team_info)
                        if team_num_match:
                            team_number = team_num_match.group(1)
                            team_name = self._normalize_team_name(team_num_match.group(2))
                        else:
                            team_number = ""
                            team_name = self._normalize_team_name(team_info)
                        
                        if not team_name or team_name == '-':
                            continue
                        
                        # Parse numeric values
                        def parse_int(val):
                            val = re.sub(r'[^\d-]', '', str(val))
                            return int(val) if val else 0
                        
                        # Standard column order: Team, W, L, T, GF, GA, RC, Pts
                        wins = parse_int(cell_texts[1])
                        losses = parse_int(cell_texts[2])
                        ties = parse_int(cell_texts[3])
                        goals_for = parse_int(cell_texts[4])
                        goals_against = parse_int(cell_texts[5])
                        red_cards = parse_int(cell_texts[6]) if len(cell_texts) > 6 else 0
                        points = parse_int(cell_texts[7]) if len(cell_texts) > 7 else 0
                        
                        team = TeamStanding(
                            team_number=team_number,
                            team_name=team_name,
                            wins=wins,
                            losses=losses,
                            ties=ties,
                            goals_for=goals_for,
                            goals_against=goals_against,
                            red_cards=red_cards,
                            points=points,
                            season=season,
                            division=division,
                            age_group=current_age_group,
                            subdivision=current_subdivision,
                            gender=gender
                        )
                        teams.append(team)
                        
                    except (ValueError, IndexError) as e:
                        continue
        
        return teams
    
    def scrape_standings_page(self, season: str, division: str) -> List[TeamStanding]:
        url = f"{BASE_URL}{ARCHIVES_PATH}/{season}/{division}.html"
        logger.info(f"Scraping: {url}")
        
        html = self._make_request(url)
        if not html:
            logger.warning(f"No data for {season}/{division}")
            return []
        
        teams = self._parse_html_tables(html, season, division)
        logger.info(f"Found {len(teams)} teams in {season}/{division}")
        return teams
    
    def scrape_season(self, season: str, divisions: List[str] = None) -> List[TeamStanding]:
        if divisions is None:
            divisions = DIVISIONS
            
        for division in divisions:
            teams = self.scrape_standings_page(season, division)
            self.all_teams.extend(teams)
            
        return self.all_teams
    
    def scrape_all(self) -> List[TeamStanding]:
        logger.info(f"Starting full historical scrape: {len(SEASONS)} seasons × {len(DIVISIONS)} divisions")
        for season in SEASONS:
            self.scrape_season(season)
        logger.info(f"Completed! Total teams scraped: {len(self.all_teams)}")
        return self.all_teams
    
    def save_csv(self, filename: str = None) -> str:
        try:
            import pandas as pd
            if filename is None:
                date_str = datetime.now().strftime("%Y_%m_%d")
                filename = f"heartland_standings_{date_str}.csv"
            filepath = self.output_dir / filename
            df = pd.DataFrame([asdict(t) for t in self.all_teams])
            df.to_csv(filepath, index=False)
            logger.info(f"Saved CSV: {filepath}")
            return str(filepath)
        except ImportError:
            logger.warning("pandas not installed, skipping CSV")
            return ""
    
    def save_json(self, filename: str = None) -> str:
        if filename is None:
            date_str = datetime.now().strftime("%Y_%m_%d")
            filename = f"heartland_standings_{date_str}.json"
        filepath = self.output_dir / filename
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump([asdict(t) for t in self.all_teams], f, indent=2, ensure_ascii=False)
        logger.info(f"Saved JSON: {filepath}")
        return str(filepath)
    
    def save_supabase_format(self) -> Tuple[str, str]:
        date_str = datetime.now().strftime("%Y_%m_%d")
        
        # Unique teams PER SEASON (key includes season_code)
        # This supports season-based ELO where each season is independent
        teams_seen = {}
        for team in self.all_teams:
            season_code = get_season_code(team.season)
            key = (team.team_name, team.gender, team.age_group, season_code)
            if key not in teams_seen or team.matches_played > teams_seen[key]['matches_played']:
                teams_seen[key] = {
                    'team_name': team.team_name,
                    'state': 'KS',
                    'gender': team.gender,
                    'age_group': team.age_group,
                    'season_code': season_code,  # NEW: Season-based ELO tracking
                    'source_name': 'heartland_soccer',
                    'elo_rating': 1500,
                    'wins': team.wins,
                    'losses': team.losses,
                    'draws': team.ties,
                    'matches_played': team.matches_played
                }
        
        teams_filepath = self.output_dir / f"supabase_teams_{date_str}.json"
        with open(teams_filepath, 'w', encoding='utf-8') as f:
            json.dump(list(teams_seen.values()), f, indent=2, ensure_ascii=False)
        logger.info(f"Saved {len(teams_seen)} unique team-seasons: {teams_filepath}")
        
        # All standings
        standings_data = [{
            'team_name': t.team_name,
            'season': t.season,
            'season_code': get_season_code(t.season),  # NEW: Academic year code
            'division': t.division,
            'subdivision': t.subdivision,
            'age_group': t.age_group,
            'gender': t.gender,
            'wins': t.wins,
            'losses': t.losses,
            'ties': t.ties,
            'goals_for': t.goals_for,
            'goals_against': t.goals_against,
            'points': t.points,
            'source': 'heartland_soccer',
            'source_url': f"{BASE_URL}{ARCHIVES_PATH}/{t.season}/{t.division}.html"
        } for t in self.all_teams]
        
        standings_filepath = self.output_dir / f"supabase_standings_{date_str}.json"
        with open(standings_filepath, 'w', encoding='utf-8') as f:
            json.dump(standings_data, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved standings: {standings_filepath}")
        
        return str(teams_filepath), str(standings_filepath)


def main():
    parser = argparse.ArgumentParser(description='Scrape Heartland Soccer standings')
    parser.add_argument('--all', action='store_true', help='Scrape all historical data (20+ years)')
    parser.add_argument('--years', type=int, default=3, choices=[1, 2, 3, 4], 
                        help='Number of years to scrape (default: 3)')
    parser.add_argument('--season', type=str, help='Specific season to scrape (e.g., 2024_fall)')
    parser.add_argument('--division', type=str, choices=DIVISIONS, help='Specific division')
    parser.add_argument('--output-dir', type=str, default='./heartland_data', help='Output directory')
    parser.add_argument('--debug', action='store_true', help='Save raw HTML for debugging')
    
    args = parser.parse_args()
    scraper = HeartlandScraper(output_dir=args.output_dir, debug=args.debug)
    
    if args.all:
        # Use ALL seasons
        logger.info("Scraping ALL historical data (20+ years)...")
        for season in ALL_SEASONS:
            divisions = [args.division] if args.division else DIVISIONS
            scraper.scrape_season(season, divisions)
    elif args.season:
        # Specific season
        divisions = [args.division] if args.division else DIVISIONS
        scraper.scrape_season(args.season, divisions)
    else:
        # Use --years (default 3)
        seasons = get_seasons_for_years(args.years)
        logger.info(f"Scraping {args.years} years of data: {seasons}")
        for season in seasons:
            divisions = [args.division] if args.division else DIVISIONS
            scraper.scrape_season(season, divisions)
    
    if scraper.all_teams:
        csv_path = scraper.save_csv()
        json_path = scraper.save_json()
        teams_path, standings_path = scraper.save_supabase_format()
        
        print("\n" + "="*60)
        print("SCRAPE COMPLETE!")
        print("="*60)
        print(f"Total team-season records: {len(scraper.all_teams)}")
        print(f"\nOutput files:")
        if csv_path:
            print(f"  CSV:                {csv_path}")
        print(f"  JSON:               {json_path}")
        print(f"  Supabase Teams:     {teams_path}")
        print(f"  Supabase Standings: {standings_path}")
        print("="*60)
    else:
        print("\nNo teams found. Try running with --debug to save raw HTML for inspection:")
        print("  python heartland_scraper.py --debug --division boys_prem")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())