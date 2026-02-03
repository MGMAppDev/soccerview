# Next Session Prompt - Copy/Paste This

## Start Prompt

```
Resume SoccerView. Session 65.

STATUS: Adaptive Learning FULLY INTEGRATED (Session 64)
- dataQualityEngine.js loads learned patterns before processing
- Normalizers check learned patterns first, fall back to rules
- Feedback loop: recordSuccess/recordFailure adjust confidence
- Weekly pattern learning in GitHub Actions

DEPLOYMENT NEEDED (if not done):
1. Run scripts/migrations/040_create_learned_patterns.sql in Supabase
2. Bootstrap: node scripts/universal/adaptiveLearning.js --learn-teams --source all

CURRENT DATABASE:
- teams_v2: 147,794
- matches_v2: 304,624
- clubs: 124,650
- leagues: 280
- tournaments: 1,728
- canonical_teams: 19,271
- canonical_events: 1,795
- canonical_clubs: 7,301
- learned_patterns: 0+ (after bootstrap)

WHAT'S NEXT?
The backend data pipeline is complete and SELF-IMPROVING. Options:

1. **App Features** - Add new UI features (predictions, team comparison, etc.)
2. **Data Expansion** - Add new data sources (see DATA_EXPANSION_ROADMAP.md)
3. **App Store Launch** - Final QC and submission
4. **Bug Fixes** - Address any user-reported issues
5. **Monitor Learning** - Watch pattern growth over time

What would you like to work on?
```

---

## Quick Context

### Recent Sessions
- **Session 64:** Adaptive Learning Integration - Wired into pipeline
- **Session 63:** Universal Discovery + Adaptive Learning Infrastructure
- **Session 62:** Self-Learning Canonical Registries
- **Session 61:** Alphanumeric Team ID Fix
- **Session 60:** Universal Data Quality System (Phases 0-6)

### Key Files
- `scripts/universal/dataQualityEngine.js` - Main processor (now loads learned patterns)
- `scripts/universal/adaptiveLearning.js` - Pattern learning + feedback
- `scripts/universal/normalizers/` - Team, event, match, club normalizers
- `scripts/universal/deduplication/` - Match, team, event dedup scripts
- `.github/workflows/daily-data-sync.yml` - Nightly pipeline + weekly learning

### Nightly Pipeline Flow
```
6 AM UTC Daily:
1. sync-gotsport (GotSport events)
2. sync-htgsports (HTGSports tournaments)
3. sync-heartland (Heartland CGI)
4. validation-pipeline (dataQualityEngine.js - loads learned patterns)
5. infer-event-linkage (orphan matching)
6. weekly-dedup-check (Sundays only - includes pattern learning)
7. recalculate-elo
8. score-predictions
9. refresh-views
10. generate-summary (includes Adaptive Learning section)
```

### Verify Adaptive Learning
```bash
# Check patterns loaded
node scripts/universal/dataQualityEngine.js --process-staging --limit 10 --dry-run
# Should show "📚 Loading learned patterns..." and "✅ Patterns loaded"

# Check pattern count
node -e "require('pg').Pool({connectionString:process.env.DATABASE_URL}).query('SELECT COUNT(*) FROM learned_patterns').then(r=>console.log(r.rows[0]))"
```

### TestFlight Build
Latest build submitted. Check status at:
https://expo.dev/accounts/mgmappdev/projects/soccerview/builds

If build completed, submit to TestFlight:
```bash
eas submit --platform ios --latest
```

---

## Alternative Short Prompt

```
Resume SoccerView. Backend complete + self-improving. What's next for the app?
```
