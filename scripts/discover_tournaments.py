#!/usr/bin/env python3
"""
SoccerView — Automated Tournament Discovery
Scrapes GotSport to discover tournaments and their age group URLs.
Stores results in Supabase via REST API.

Run: python scripts/discover_tournaments.py
Requires: pip install requests beautifulsoup4 python-dotenv
"""

import os
import re
import time
import logging
import json
from datetime import datetime
from typing import Optional, Dict, List, Any
from dotenv import load_dotenv

import requests
from bs4 import BeautifulSoup

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables")

# Supabase REST API headers
SUPABASE_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# Target states for scraping (major youth soccer states)
TARGET_STATES = ["TX", "CA", "FL", "VA", "GA", "NC", "PA", "NY", "NJ", "MD", "IL", "OH", "CO", "AZ", "WA", "MO", "KS"]

# GotSport base URLs
GOTSPORT_BASE = "https://system.gotsport.com"
TOURNAMENTS_URL = f"{GOTSPORT_BASE}/tournaments"

# Request settings
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}
REQUEST_DELAY = 2  # seconds between requests
MAX_RETRIES = 3


# ---------------------------
# Supabase REST API Functions
# ---------------------------

def supabase_select(table: str, params: Dict = None) -> List[Dict]:
    """SELECT from Supabase table via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        response = requests.get(url, headers=SUPABASE_HEADERS, params=params or {})
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Supabase SELECT error on {table}: {e}")
        return []


def supabase_upsert(table: str, data: Dict, on_conflict: str = None) -> Optional[Dict]:
    """UPSERT to Supabase table via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = SUPABASE_HEADERS.copy()
    
    if on_conflict:
        headers["Prefer"] = f"resolution=merge-duplicates,return=representation"
    
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        result = response.json()
        return result[0] if isinstance(result, list) and result else result
    except Exception as e:
        logger.error(f"Supabase UPSERT error on {table}: {e}")
        return None


def supabase_update(table: str, data: Dict, match_column: str, match_value: str) -> bool:
    """UPDATE Supabase table via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?{match_column}=eq.{match_value}"
    try:
        response = requests.patch(url, headers=SUPABASE_HEADERS, json=data)
        response.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Supabase UPDATE error on {table}: {e}")
        return False


# ---------------------------
# HTTP Request Helper
# ---------------------------

def make_request(url: str, retries: int = MAX_RETRIES) -> Optional[requests.Response]:
    """Make HTTP request with retry logic and rate limiting."""
    for attempt in range(retries):
        try:
            time.sleep(REQUEST_DELAY)
            response = requests.get(url, headers=HEADERS, timeout=30)
            response.raise_for_status()
            return response
        except requests.RequestException as e:
            logger.warning(f"Request failed (attempt {attempt + 1}/{retries}): {url} - {e}")
            if attempt < retries - 1:
                time.sleep(REQUEST_DELAY * 2)
    return None


# ---------------------------
# Parsing Helpers
# ---------------------------

def extract_state_from_location(location: str) -> Optional[str]:
    """Extract state code from location string."""
    if not location:
        return None
    
    # Common patterns: "City, ST" or "City, State"
    state_pattern = r',\s*([A-Z]{2})(?:\s|$|,)'
    match = re.search(state_pattern, location)
    if match:
        state = match.group(1)
        if state in TARGET_STATES:
            return state
    
    # Full state names
    state_names = {
        "Texas": "TX", "California": "CA", "Florida": "FL", "Virginia": "VA",
        "Georgia": "GA", "North Carolina": "NC", "Pennsylvania": "PA",
        "New York": "NY", "New Jersey": "NJ", "Maryland": "MD",
        "Illinois": "IL", "Ohio": "OH", "Colorado": "CO", "Arizona": "AZ",
        "Washington": "WA", "Missouri": "MO", "Kansas": "KS"
    }
    for name, code in state_names.items():
        if name.lower() in location.lower():
            return code
    
    return None


# ---------------------------
# Tournament Discovery
# ---------------------------

def discover_tournaments(max_pages: int = 20) -> List[Dict]:
    """
    Scrape GotSport tournaments list to discover events.
    Returns list of tournament dictionaries.
    """
    tournaments = []
    seen_event_ids = set()
    
    for current_page in range(1, max_pages + 1):
        url = f"{TOURNAMENTS_URL}?page={current_page}"
        logger.info(f"Fetching tournaments page {current_page}...")
        
        response = make_request(url)
        if not response:
            logger.error(f"Failed to fetch page {current_page}")
            break
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Find all links to events
        event_links = soup.find_all('a', href=re.compile(r'/org_event/events/\d+'))
        
        page_count = 0
        for link in event_links:
            href = link.get('href', '')
            event_match = re.search(r'/org_event/events/(\d+)', href)
            if event_match:
                event_id = event_match.group(1)
                
                if event_id in seen_event_ids:
                    continue
                seen_event_ids.add(event_id)
                page_count += 1
                
                name = link.get_text(strip=True) or f"Event {event_id}"
                
                # Try to find location/date nearby
                parent = link.find_parent(['tr', 'div', 'li', 'td'])
                location = ""
                
                if parent:
                    location = parent.get_text(" ", strip=True)
                
                state = extract_state_from_location(location)
                
                tournaments.append({
                    'event_id': event_id,
                    'name': name[:255] if name else f"Event {event_id}",
                    'state': state,
                    'city': None,
                    'start_date': None,
                    'end_date': None,
                })
        
        logger.info(f"  Found {page_count} new tournaments on page {current_page}")
        
        # Check if we've hit the last page
        if page_count == 0 and current_page > 1:
            logger.info(f"No new tournaments on page {current_page}, stopping")
            break
    
    logger.info(f"Discovered {len(tournaments)} tournaments total")
    return tournaments


def discover_tournament_groups(event_id: str) -> List[Dict]:
    """
    Drill into a tournament to discover all age group schedule URLs.
    Returns list of group dictionaries.
    """
    groups = []
    url = f"{GOTSPORT_BASE}/org_event/events/{event_id}/schedules"
    
    logger.info(f"  Discovering groups for event {event_id}...")
    
    response = make_request(url)
    if not response:
        logger.error(f"  Failed to fetch event {event_id}")
        return groups
    
    soup = BeautifulSoup(response.text, 'html.parser')
    
    # Find all links with group parameter
    group_links = soup.find_all('a', href=re.compile(r'group=\d+'))
    
    seen_groups = set()
    for link in group_links:
        href = link.get('href', '')
        group_match = re.search(r'group=(\d+)', href)
        
        if group_match:
            group_id = group_match.group(1)
            
            if group_id in seen_groups:
                continue
            seen_groups.add(group_id)
            
            # Get division name from link text or parent
            division_name = link.get_text(strip=True)
            if not division_name:
                parent = link.find_parent(['li', 'td', 'div'])
                if parent:
                    division_name = parent.get_text(strip=True)
            
            # Infer age group and gender from division name
            age_group = None
            gender = None
            
            if division_name:
                lower_name = division_name.lower()
                
                # Age group patterns
                age_match = re.search(r'u[- ]?(\d{1,2})', lower_name)
                if age_match:
                    age_group = f"U{age_match.group(1)}"
                else:
                    year_match = re.search(r'\b(20[01]\d)\b', lower_name)
                    if year_match:
                        birth_year = int(year_match.group(1))
                        current_year = datetime.now().year
                        age = current_year - birth_year
                        age_group = f"U{age}"
                
                # Gender patterns
                if 'boys' in lower_name or ' b ' in lower_name or re.search(r'\bb\d{2}', lower_name):
                    gender = "Boys"
                elif 'girls' in lower_name or ' g ' in lower_name or re.search(r'\bg\d{2}', lower_name):
                    gender = "Girls"
            
            # Build full URL
            full_url = f"{GOTSPORT_BASE}/org_event/events/{event_id}/schedules?group={group_id}"
            
            groups.append({
                'event_id': event_id,
                'group_id': group_id,
                'url': full_url,
                'division_name': division_name[:255] if division_name else None,
                'age_group': age_group,
                'gender': gender,
            })
    
    logger.info(f"    Found {len(groups)} groups")
    return groups


# ---------------------------
# Database Operations
# ---------------------------

def save_tournament(tournament: Dict) -> Optional[str]:
    """Save or update tournament in database. Returns tournament UUID."""
    # Check if exists
    existing = supabase_select(
        "tournament_sources",
        {"event_id": f"eq.{tournament['event_id']}", "select": "id"}
    )
    
    if existing:
        # Update existing
        supabase_update(
            "tournament_sources",
            {
                'name': tournament.get('name'),
                'state': tournament.get('state'),
            },
            "event_id",
            tournament['event_id']
        )
        return existing[0]['id']
    else:
        # Insert new
        result = supabase_upsert("tournament_sources", {
            'event_id': tournament['event_id'],
            'name': tournament.get('name'),
            'state': tournament.get('state'),
            'provider': 'gotsport',
        })
        return result.get('id') if result else None


def save_scrape_target(tournament_id: str, group: Dict, state: Optional[str]) -> bool:
    """Save or update scrape target in database."""
    data = {
        'tournament_id': tournament_id,
        'event_id': group['event_id'],
        'group_id': group['group_id'],
        'url': group['url'],
        'age_group': group.get('age_group'),
        'gender': group.get('gender'),
        'division_name': group.get('division_name'),
        'state': state,
        'is_active': True,
    }
    
    result = supabase_upsert("scrape_targets", data, on_conflict="event_id,group_id")
    return result is not None


# ---------------------------
# Main Discovery Process
# ---------------------------

def run_discovery(target_states: List[str] = None, max_tournament_pages: int = 10):
    """
    Main discovery process:
    1. Scrape tournament listings
    2. Filter by target states
    3. Drill into each tournament for group URLs
    4. Save everything to database
    """
    if target_states is None:
        target_states = TARGET_STATES
    
    logger.info("=" * 60)
    logger.info("SoccerView Tournament Discovery")
    logger.info(f"Target states: {', '.join(target_states)}")
    logger.info("=" * 60)
    
    # Step 1: Discover tournaments
    tournaments = discover_tournaments(max_pages=max_tournament_pages)
    
    # Filter by target states (keep unknown states too)
    relevant_tournaments = [
        t for t in tournaments 
        if t.get('state') is None or t.get('state') in target_states
    ]
    
    logger.info(f"Processing {len(relevant_tournaments)} relevant tournaments...")
    
    tournaments_saved = 0
    groups_saved = 0
    
    # Step 2: Process each tournament
    for i, tournament in enumerate(relevant_tournaments):
        logger.info(f"[{i+1}/{len(relevant_tournaments)}] {tournament.get('name', 'Unknown')}")
        
        # Save tournament
        tournament_uuid = save_tournament(tournament)
        if tournament_uuid:
            tournaments_saved += 1
        else:
            continue
        
        # Step 3: Discover groups
        groups = discover_tournament_groups(tournament['event_id'])
        
        # Step 4: Save groups as scrape targets
        for group in groups:
            if save_scrape_target(tournament_uuid, group, tournament.get('state')):
                groups_saved += 1
    
    logger.info("=" * 60)
    logger.info("Discovery Complete!")
    logger.info(f"Tournaments saved: {tournaments_saved}")
    logger.info(f"Scrape targets saved: {groups_saved}")
    logger.info("=" * 60)
    
    return {'tournaments': tournaments_saved, 'groups': groups_saved}


def add_known_tournaments():
    """
    Manually add known major tournaments that might not appear in listings.
    """
    known_tournaments = [
        # Florida tournaments we already have
        {'event_id': '43745', 'name': 'Labor Day 2025 Jacksonville', 'state': 'FL'},
        {'event_id': '33224', 'name': 'Presidents Day 2025 FL', 'state': 'FL'},
    ]
    
    logger.info("Adding known tournaments...")
    
    for tournament in known_tournaments:
        tournament_uuid = save_tournament(tournament)
        if tournament_uuid:
            groups = discover_tournament_groups(tournament['event_id'])
            for group in groups:
                save_scrape_target(tournament_uuid, group, tournament.get('state'))
    
    logger.info(f"Processed {len(known_tournaments)} known tournaments")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Discover GotSport tournaments')
    parser.add_argument('--pages', type=int, default=10, help='Max pages to scrape')
    parser.add_argument('--states', nargs='+', default=None, help='Target states')
    parser.add_argument('--known-only', action='store_true', help='Only process known tournaments')
    
    args = parser.parse_args()
    
    if args.known_only:
        add_known_tournaments()
    else:
        run_discovery(target_states=args.states, max_tournament_pages=args.pages)
        add_known_tournaments()