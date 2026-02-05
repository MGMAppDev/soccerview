-- Migration 091: Block Generic Event Names
-- Session 91: Prevent future tournament/league creation with useless generic names
--
-- Pattern coverage:
--   "HTGSports Event 12093", "GotSport Event 39064", "Event 12345"
--   Bare numbers: "12093"
--   Bare platform names: "GotSport", "HTGSports", "Heartland"
--
-- Prerequisite: Run fixGenericEventNames.cjs --execute first to clean existing data

-- Tournaments
ALTER TABLE tournaments ADD CONSTRAINT chk_tournament_name_not_generic
  CHECK (
    name !~ '^(HTGSports |GotSport |Heartland )?Event \d+$'
    AND name !~ '^\d+$'
    AND name !~ '^(GotSport|HTGSports|Heartland)$'
  );

-- Leagues
ALTER TABLE leagues ADD CONSTRAINT chk_league_name_not_generic
  CHECK (
    name !~ '^(HTGSports |GotSport |Heartland )?Event \d+$'
    AND name !~ '^\d+$'
    AND name !~ '^(GotSport|HTGSports|Heartland)$'
  );

-- Verification: These should all fail
-- INSERT INTO tournaments (name, start_date) VALUES ('GotSport Event 99999', '2026-01-01'); -- FAIL
-- INSERT INTO tournaments (name, start_date) VALUES ('HTGSports Event 12345', '2026-01-01'); -- FAIL
-- INSERT INTO tournaments (name, start_date) VALUES ('12345', '2026-01-01'); -- FAIL
-- INSERT INTO tournaments (name, start_date) VALUES ('GotSport', '2026-01-01'); -- FAIL
-- INSERT INTO tournaments (name, start_date) VALUES ('Plano Labor Day Invitational 2024', '2026-01-01'); -- OK
