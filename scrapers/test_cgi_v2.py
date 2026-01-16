#!/usr/bin/env python3
"""
Diagnostic script v2 - test different parameter combinations
"""
import requests

session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.heartlandsoccer.net/league/score-standings/',
})

base_url = "https://www.heartlandsoccer.net/reports/cgi-jrb/subdiv_standings.cgi"

# Try different parameter combinations
test_cases = [
    # Based on error output - CGI expects: level, sex, age, subdivision
    # level=Premier, sex=Boys
    {"level": "Premier", "sex": "Boys", "age": "U-11", "subdivision": "1"},
    
    # Same but with subdivison (typo from HTML form)
    {"level": "Premier", "sex": "Boys", "age": "U-11", "subdivison": "1"},
    
    # Try different age groups that might have data
    {"level": "Premier", "sex": "Boys", "age": "U-14", "subdivision": "1"},
    {"level": "Premier", "sex": "Girls", "age": "U-12", "subdivision": "1"},
    
    # Recreational
    {"level": "Recreational", "sex": "Boys", "age": "U-11/5th Grade 9v9", "subdivision": "1"},
]

print("Testing parameter combinations...\n")

for i, params in enumerate(test_cases):
    print(f"Test {i+1}: {params}")
    try:
        resp = session.get(base_url, params=params, timeout=10)
        has_error = 'could not match' in resp.text.lower() or 'error' in resp.text[:200].lower()
        has_table = '<table' in resp.text.lower()
        
        # Look for team data indicators
        has_team_data = 'subdivision' in resp.text.lower() and 'win' in resp.text.lower()
        
        print(f"  Status: {resp.status_code}, Size: {len(resp.text)}")
        print(f"  Has error: {has_error}, Has table: {has_table}, Has team data: {has_team_data}")
        
        if not has_error and (has_table or has_team_data):
            filename = f"heartland_data/working_test_{i+1}.html"
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(resp.text)
            print(f"  *** POSSIBLE SUCCESS! Saved to {filename}")
        print()
        
    except Exception as e:
        print(f"  ERROR: {e}\n")

# Also test the subdiv_results endpoint with same variations
print("\n" + "="*50)
print("Testing subdiv_results.cgi endpoint...")
print("="*50 + "\n")

results_url = "https://www.heartlandsoccer.net/reports/cgi-jrb/subdiv_results.cgi"

for i, params in enumerate(test_cases):  # Test all
    print(f"Test {i+1}: {params}")
    try:
        resp = session.get(results_url, params=params, timeout=10)
        has_error = 'could not match' in resp.text.lower()
        has_team = any(x in resp.text.lower() for x in ['premier', 'fc ', 'academy', 'sporting'])
        print(f"  Status: {resp.status_code}, Size: {len(resp.text)}, Has error: {has_error}, Has team names: {has_team}")
        
        if not has_error and len(resp.text) > 2000:
            filename = f"heartland_data/results_test_{i+1}.html"
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(resp.text)
            print(f"  *** Saved to {filename}")
        print()
    except Exception as e:
        print(f"  ERROR: {e}\n")

print("Done!")