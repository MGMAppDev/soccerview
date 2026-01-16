#!/usr/bin/env python3
"""
Heartland Soccer Association Data Scraper (v4 - Archive + Live CGI)
====================================================================
Scrapes team standings from heartlandsoccer.net using:
  1. Static archive pages (past seasons)
  2. Live CGI endpoints (current season)

Usage:
    python heartland_scraper_v4.py                    # 3 years of data (default)
    python heartland_scraper_v4.py --years 3         # Explicit 3 years
    python heartland_scraper_v4.py --live            # Current season via CGI only
    python heartland_scraper_v4.py --season 2025_fall --live  # Force CGI for specific season
    python heartland_scraper_v4.py --debug           # Save raw HTML for inspection
"""

import requests
from bs4 import BeautifulSoup
import re
import json
import time
import argparse
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple, Dict
from dataclasses import dataclass, asdict
from urllib.parse import urlencode
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
CGI_STANDINGS_PATH = "/reports/cgi-jrb/subdiv_standings.cgi"

# Current season (January 2026 = 2025-26 academic year)
CURRENT_SEASON = "2025_fall"
CURRENT_SEASON_CODE = "2025-26"

# CGI Form Configuration - Premier divisions
PREMIER_AGE_GROUPS = ["U-9", "U-10", "U-11", "U-12", "U-13", "U-14", "U-15", "U-16", "U-17", "U-18", "U-19"]
PREMIER_SUBDIVISIONS = list(range(1, 15))  # 1-14

# CGI Form Configuration - Recreational divisions  
REC_AGE_GROUPS = [
    "U-9/3rd Grade 7v7", "U-9/10-3rd/4th Grade 9v9", 
    "U-10/4th Grade 7v7", "U-10/4th Grade 9v9",
    "U-11/5th Grade 9v9", "U-12/6th Grade 9v9",
    "U-13/7th Grade", "U-14/8th Grade", "U-14/15-8th/9th Grade"
]
REC_SUBDIVISIONS = ["CANADA", "MEXICO", "USA", "1", "2", "3"]

ALL_SEASONS = [
    "2025_fall", "2024_fall", "2023_fall", "2022_fall", "2021_fall", "2020_fall",
    "2019_fall", "2018_fall", "2017_fall", "2016_fall", "2015_fall",
    "2014_fall", "2013_fall", "2012_fall", "2011_fall", "2010_fall",
    "2009_fall", "2008_fall", "2007_fall", "2006_fall", "2005_fall",
    "2004_fall", "2003_fall", "2002_fall",
    "2026_spring", "2025_spring", "2024_spring", "2023_spring", "2022_spring", 
    "2021_spring", "2019_spring", "2018_spring", "2017_spring", "2016_spring", 
    "2015_spring", "2014_spring", "2013_spring", "2012_spring", "2011_spring", 
    "2010_spring", "2009_spring", "2008_spring", "2007_spring", "2005_spring", 
    "2004_spring", "2003_spring"
]

DIVISIONS = ["boys_prem", "girls_prem", "boys_rec", "girls_rec"]
REQUEST_DELAY = 0.5  # Slightly faster for CGI (many requests needed)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_seasons_for_years(years: int) -> List[str]:
    """Get seasons for the last N years (fall + spring per year)."""
    season_map = {
        1: ["2025_fall", "2026_spring"],
        2: ["2024_fall", "2025_spring"],
        3: ["2023_fall", "2024_spring"],
        4: ["2022_fall", "2023_spring"],
    }
    seasons = []
    for y in range(1, min(years + 1, 5)):
        seasons.extend(season_map.get(y, []))
    return [s for s in seasons if s in ALL_SEASONS]

def get_season_code(season: str) -> str:
    """Convert season string to academic year code."""
    parts = season.split('_')
    if len(parts) != 2:
        return season
    year = int(parts[0])
    term = parts[1]
    if term == 'fall':
        return f"{year}-{str(year + 1)[-2:]}"
    else:
        return f"{year - 1}-{str(year)[-2:]}"

def is_current_season(season: str) -> bool:
    """Check if this is the current (not yet archived) season."""
    return season in ["2025_fall", "2026_spring"]

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
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://www.heartlandsoccer.net/league/score-standings/',
        })
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.all_teams: List[TeamStanding] = []
        self.debug = debug
        self.failed_requests: List[str] = []
        
    def _make_request(self, url: str, params: Dict = None) -> Optional[str]:
        """Make a rate-limited HTTP request."""
        try:
            time.sleep(REQUEST_DELAY)
            if params:
                response = self.session.get(url, params=params, timeout=30)
            else:
                response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            logger.debug(f"Request failed for {url}: {e}")
            return None
    
    def _parse_gender(self, division: str) -> str:
        if division.startswith("boys") or "Boys" in division:
            return "Boys"
        elif division.startswith("girls") or "Girls" in division:
            return "Girls"
        return "Unknown"
    
    def _normalize_team_name(self, name: str) -> str:
        name = ' '.join(name.split())
        return name.strip()
    
    def _extract_age_group(self, text: str) -> str:
        """Extract U-XX age group from text."""
        match = re.search(r'U-?(\d+)', text, re.IGNORECASE)
        if match:
            return f"U{match.group(1)}"
        return "Unknown"

    # =========================================================================
    # ARCHIVE PARSER (Static HTML pages for past seasons)
    # =========================================================================
    
    def _parse_archive_html(self, html: str, season: str, division: str) -> List[TeamStanding]:
        """Parse static archive HTML pages."""
        teams = []
        gender = self._parse_gender(division)
        soup = BeautifulSoup(html, 'html.parser')
        
        current_age_group = "Unknown"
        current_subdivision = "Unknown"
        
        for element in soup.find_all(['h2', 'h3', 'h4', 'table', 'p', 'b', 'strong']):
            tag_name = element.name
            text = element.get_text(strip=True)
            
            # Check for subdivision header
            if tag_name in ['h2', 'h3', 'h4', 'p', 'b', 'strong']:
                age_match = re.search(r'U-?(\d+)', text, re.IGNORECASE)
                if age_match and ('Subdivision' in text or 'Division' in text or 'Premier' in text or 'Recreational' in text):
                    current_age_group = f"U{age_match.group(1)}"
                    current_subdivision = text
                    continue
            
            # Parse table
            if tag_name == 'table':
                teams.extend(self._parse_standings_table(
                    element, season, division, gender, 
                    current_age_group, current_subdivision
                ))
        
        return teams
    
    def _parse_standings_table(self, table_elem, season: str, division: str, 
                                gender: str, age_group: str, subdivision: str) -> List[TeamStanding]:
        """Parse a standings table element."""
        teams = []
        rows = table_elem.find_all('tr')
        
        for row in rows:
            cells = row.find_all(['td', 'th'])
            if len(cells) < 8:
                continue
            
            cell_texts = [cell.get_text(strip=True) for cell in cells]
            first_cell = cell_texts[0].lower()
            
            # Skip headers
            if first_cell in ['#', 'team', 'number', ''] or 'subdivision' in first_cell:
                continue
            if 'win' in first_cell or 'lose' in first_cell:
                continue
            
            try:
                team_info = cell_texts[0]
                team_num_match = re.match(r'^([0-9A-Za-z]{4})\s+(.+)$', team_info)
                if team_num_match:
                    team_number = team_num_match.group(1)
                    team_name = self._normalize_team_name(team_num_match.group(2))
                else:
                    team_number = ""
                    team_name = self._normalize_team_name(team_info)
                
                if not team_name or team_name == '-':
                    continue
                
                def parse_int(val):
                    val = re.sub(r'[^\d-]', '', str(val))
                    return int(val) if val else 0
                
                teams.append(TeamStanding(
                    team_number=team_number,
                    team_name=team_name,
                    wins=parse_int(cell_texts[1]),
                    losses=parse_int(cell_texts[2]),
                    ties=parse_int(cell_texts[3]),
                    goals_for=parse_int(cell_texts[4]),
                    goals_against=parse_int(cell_texts[5]),
                    red_cards=parse_int(cell_texts[6]) if len(cell_texts) > 6 else 0,
                    points=parse_int(cell_texts[7]) if len(cell_texts) > 7 else 0,
                    season=season,
                    division=division,
                    age_group=age_group,
                    subdivision=subdivision,
                    gender=gender
                ))
            except (ValueError, IndexError):
                continue
        
        return teams

    # =========================================================================
    # CGI PARSER (Live data for current season)
    # =========================================================================
    
    def _scrape_cgi_standings(self, gender: str, level: str, age: str, 
                              subdivision: str, season: str) -> List[TeamStanding]:
        """Scrape standings from CGI endpoint for a specific subdivision."""
        
        # Correct CGI parameters (discovered via testing)
        params = {
            'level': level,          # Premier or Recreational  
            'sex': gender,           # Boys or Girls
            'age': age,              # U-9, U-10, etc.
            'subdivision': subdivision
        }
        
        url = f"{BASE_URL}{CGI_STANDINGS_PATH}"
        
        html = self._make_request(url, params)
        if not html:
            return []
        
        # Check for error page
        if 'could not match this combination' in html.lower() or 'error' in html.lower()[:500]:
            return []
        
        # Save debug HTML if requested
        if self.debug:
            debug_file = self.output_dir / f"debug_cgi_{gender}_{level}_{age}_{subdivision}.html"
            with open(debug_file, 'w', encoding='utf-8') as f:
                f.write(html)
        
        # Parse the response
        return self._parse_cgi_response(html, season, gender, level, age, subdivision)
    
    def _parse_cgi_response(self, html: str, season: str, gender: str, 
                            level: str, age: str, subdivision: str) -> List[TeamStanding]:
        """Parse CGI standings response HTML."""
        teams = []
        soup = BeautifulSoup(html, 'html.parser')
        
        # Determine division string
        if level == "Premier":
            division = f"{'boys' if gender == 'Boys' else 'girls'}_prem"
        else:
            division = f"{'boys' if gender == 'Boys' else 'girls'}_rec"
        
        age_group = self._extract_age_group(age)
        subdivision_name = f"{age} {gender} {level} Subdivision {subdivision}"
        
        # Find standings table(s)
        tables = soup.find_all('table')
        
        for table in tables:
            rows = table.find_all('tr')
            
            for row in rows:
                cells = row.find_all(['td', 'th'])
                if len(cells) < 6:  # Need at least team + W/L/T/GF/GA
                    continue
                
                cell_texts = [cell.get_text(strip=True) for cell in cells]
                first_cell = cell_texts[0].lower()
                
                # Skip header rows
                if any(header in first_cell for header in ['team', 'win', 'lose', 'tie', '#', 'subdivision']):
                    continue
                if first_cell == '' or first_cell == '-':
                    continue
                
                try:
                    team_info = cell_texts[0]
                    
                    # Extract team number (4 chars) and name
                    team_num_match = re.match(r'^([0-9A-Za-z]{4})\s+(.+)$', team_info)
                    if team_num_match:
                        team_number = team_num_match.group(1)
                        team_name = self._normalize_team_name(team_num_match.group(2))
                    else:
                        team_number = ""
                        team_name = self._normalize_team_name(team_info)
                    
                    if not team_name or len(team_name) < 3:
                        continue
                    
                    def parse_int(val):
                        val = re.sub(r'[^\d-]', '', str(val))
                        return int(val) if val and val != '-' else 0
                    
                    # Column order may vary - try to be flexible
                    # Standard: Team | W | L | T | GF | GA | RC | Pts
                    wins = parse_int(cell_texts[1]) if len(cell_texts) > 1 else 0
                    losses = parse_int(cell_texts[2]) if len(cell_texts) > 2 else 0
                    ties = parse_int(cell_texts[3]) if len(cell_texts) > 3 else 0
                    goals_for = parse_int(cell_texts[4]) if len(cell_texts) > 4 else 0
                    goals_against = parse_int(cell_texts[5]) if len(cell_texts) > 5 else 0
                    red_cards = parse_int(cell_texts[6]) if len(cell_texts) > 6 else 0
                    points = parse_int(cell_texts[7]) if len(cell_texts) > 7 else 0
                    
                    teams.append(TeamStanding(
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
                        age_group=age_group,
                        subdivision=subdivision_name,
                        gender=gender
                    ))
                    
                except (ValueError, IndexError) as e:
                    continue
        
        return teams

    def scrape_live_division(self, gender: str, level: str, season: str) -> List[TeamStanding]:
        """Scrape all subdivisions for a gender/level combination via CGI."""
        teams = []
        
        if level == "Premier":
            age_groups = PREMIER_AGE_GROUPS
            subdivisions = PREMIER_SUBDIVISIONS
        else:
            age_groups = REC_AGE_GROUPS
            subdivisions = REC_SUBDIVISIONS
        
        total_combos = len(age_groups) * len(subdivisions)
        logger.info(f"Scraping {gender} {level}: {len(age_groups)} ages × {len(subdivisions)} subdivisions = {total_combos} requests")
        
        found_count = 0
        for age in age_groups:
            for subdiv in subdivisions:
                subdiv_teams = self._scrape_cgi_standings(
                    gender=gender,
                    level=level,
                    age=age,
                    subdivision=str(subdiv),
                    season=season
                )
                if subdiv_teams:
                    teams.extend(subdiv_teams)
                    found_count += len(subdiv_teams)
                    logger.debug(f"  {age} Subdiv {subdiv}: {len(subdiv_teams)} teams")
        
        logger.info(f"  Found {found_count} teams in {gender} {level}")
        return teams

    def scrape_live_season(self, season: str = CURRENT_SEASON) -> List[TeamStanding]:
        """Scrape current season via CGI endpoints."""
        logger.info(f"Scraping LIVE data for {season} via CGI...")
        
        season_teams = []
        
        # Boys Premier
        teams = self.scrape_live_division("Boys", "Premier", season)
        season_teams.extend(teams)
        self.all_teams.extend(teams)
        
        # Girls Premier
        teams = self.scrape_live_division("Girls", "Premier", season)
        season_teams.extend(teams)
        self.all_teams.extend(teams)
        
        # Boys Recreational
        teams = self.scrape_live_division("Boys", "Recreational", season)
        season_teams.extend(teams)
        self.all_teams.extend(teams)
        
        # Girls Recreational
        teams = self.scrape_live_division("Girls", "Recreational", season)
        season_teams.extend(teams)
        self.all_teams.extend(teams)
        
        logger.info(f"Live scrape complete: {len(season_teams)} total teams for {season}")
        return season_teams

    # =========================================================================
    # ARCHIVE SCRAPING (Static pages)
    # =========================================================================
    
    def scrape_archive_page(self, season: str, division: str) -> List[TeamStanding]:
        """Scrape a static archive page."""
        url = f"{BASE_URL}{ARCHIVES_PATH}/{season}/{division}.html"
        logger.info(f"Scraping archive: {url}")
        
        html = self._make_request(url)
        if not html:
            logger.debug(f"No archive data for {season}/{division}")
            return []
        
        if self.debug:
            debug_file = self.output_dir / f"debug_archive_{season}_{division}.html"
            with open(debug_file, 'w', encoding='utf-8') as f:
                f.write(html)
        
        teams = self._parse_archive_html(html, season, division)
        logger.info(f"Found {len(teams)} teams in {season}/{division}")
        return teams
    
    def scrape_archive_season(self, season: str, divisions: List[str] = None) -> List[TeamStanding]:
        """Scrape all divisions for a season from archives."""
        if divisions is None:
            divisions = DIVISIONS
            
        season_teams = []
        for division in divisions:
            teams = self.scrape_archive_page(season, division)
            season_teams.extend(teams)
            self.all_teams.extend(teams)
        
        return season_teams

    # =========================================================================
    # UNIFIED SCRAPING (Auto-selects archive vs live)
    # =========================================================================
    
    def scrape_season(self, season: str, force_live: bool = False) -> List[TeamStanding]:
        """
        Scrape a season - automatically chooses archive or live CGI.
        
        Args:
            season: Season string (e.g., '2025_fall')
            force_live: Force use of CGI even if archive might exist
        """
        if force_live or is_current_season(season):
            logger.info(f"Using LIVE CGI for {season}")
            return self.scrape_live_season(season)
        else:
            # Try archive first
            logger.info(f"Using ARCHIVE for {season}")
            teams = self.scrape_archive_season(season)
            
            # If archive is empty, try CGI as fallback
            if not teams:
                logger.info(f"Archive empty, trying CGI for {season}")
                return self.scrape_live_season(season)
            
            return teams

    def scrape_years(self, years: int = 3, force_live: bool = False) -> List[TeamStanding]:
        """Scrape data for the last N years."""
        seasons = get_seasons_for_years(years)
        logger.info(f"Scraping {years} years: {seasons}")
        
        for season in seasons:
            self.scrape_season(season, force_live=force_live)
        
        logger.info(f"Total teams scraped: {len(self.all_teams)}")
        return self.all_teams

    # =========================================================================
    # OUTPUT METHODS
    # =========================================================================
    
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
        
        # Unique teams PER SEASON
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
                    'season_code': season_code,
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
            'season_code': get_season_code(t.season),
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


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Scrape Heartland Soccer standings (Archive + Live CGI)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python heartland_scraper_v4.py                      # 3 years (archive + live)
  python heartland_scraper_v4.py --years 3            # Explicit 3 years
  python heartland_scraper_v4.py --live               # Current season only (CGI)
  python heartland_scraper_v4.py --season 2025_fall   # Specific season
  python heartland_scraper_v4.py --debug              # Save debug HTML
        """
    )
    parser.add_argument('--years', type=int, default=3, choices=[1, 2, 3, 4],
                        help='Number of years to scrape (default: 3)')
    parser.add_argument('--live', action='store_true',
                        help='Scrape current season via live CGI only')
    parser.add_argument('--season', type=str,
                        help='Specific season to scrape')
    parser.add_argument('--force-live', action='store_true',
                        help='Force CGI scraping even for archived seasons')
    parser.add_argument('--output-dir', type=str, default='./heartland_data',
                        help='Output directory')
    parser.add_argument('--debug', action='store_true',
                        help='Save raw HTML for debugging')
    
    args = parser.parse_args()
    scraper = HeartlandScraper(output_dir=args.output_dir, debug=args.debug)
    
    if args.live:
        # Current season only via CGI
        scraper.scrape_live_season(CURRENT_SEASON)
    elif args.season:
        # Specific season
        scraper.scrape_season(args.season, force_live=args.force_live)
    else:
        # Default: N years of data
        scraper.scrape_years(args.years, force_live=args.force_live)
    
    # Save outputs
    if scraper.all_teams:
        csv_path = scraper.save_csv()
        json_path = scraper.save_json()
        teams_path, standings_path = scraper.save_supabase_format()
        
        # Summary by season
        season_counts = {}
        for team in scraper.all_teams:
            sc = get_season_code(team.season)
            season_counts[sc] = season_counts.get(sc, 0) + 1
        
        print("\n" + "="*60)
        print("SCRAPE COMPLETE!")
        print("="*60)
        print(f"Total team-season records: {len(scraper.all_teams)}")
        print("\nBy season:")
        for sc in sorted(season_counts.keys(), reverse=True):
            print(f"  {sc}: {season_counts[sc]} teams")
        print(f"\nOutput files:")
        if csv_path:
            print(f"  CSV:                {csv_path}")
        print(f"  JSON:               {json_path}")
        print(f"  Supabase Teams:     {teams_path}")
        print(f"  Supabase Standings: {standings_path}")
        print("="*60)
    else:
        print("\nNo teams found.")
        if scraper.failed_requests:
            print(f"Failed requests: {len(scraper.failed_requests)}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())