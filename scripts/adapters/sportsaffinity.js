/**
 * SportsAffinity Source Adapter v1.0
 * ===================================
 *
 * Scrapes match data from SportsAffinity/Sports Connect (Stack Sports) platform.
 * Primary target: Georgia Soccer (biggest coverage gap — 10.9% coverage, 4,107 orphans).
 *
 * TECHNOLOGY: Cheerio (server-rendered ASP.NET WebForms — no JavaScript needed)
 * PLATFORM: SportsAffinity old ASP.NET system at gs*.sportsaffinity.com
 *
 * Architecture (confirmed from diagnostic 2026-02-15):
 * - Season-specific subdomains: gs-fall25gplacadathclrias.sportsaffinity.com
 * - Tournament/season identified by GUID
 * - Flights (age groups/divisions) discovered from accepted_list.asp
 * - Schedule data at schedule_results2.asp per flight
 * - HTML tables with 10 columns: Game, Venue, Time, Field, Group, Home, Score, vs, Away, Score
 * - Date headers in <b> tags: "Bracket - Saturday, September 06, 2025"
 * - Age codes in flight URLs: agecode=B12, B13, B14, B15, B16, B17, B19
 * - Flight names in <td> cells on accepted_list.asp: "12UB Pre GPL", "13UB GPL", etc.
 *
 * States using SportsAffinity: GA, MN, UT, OR, NE, PA-W, HI
 * Multi-state adapter — each staticEvent carries its own state + subdomain.
 *
 * Usage:
 *   node scripts/universal/coreScraper.js --adapter sportsaffinity
 *   node scripts/universal/coreScraper.js --adapter sportsaffinity --event fall2025
 *   node scripts/universal/coreScraper.js --adapter sportsaffinity --dry-run
 */

export default {
  // =========================================
  // METADATA
  // =========================================

  id: "sportsaffinity",
  name: "SportsAffinity",
  baseUrl: "https://gs.sportsaffinity.com",

  // =========================================
  // TECHNOLOGY
  // =========================================

  technology: "cheerio",

  // =========================================
  // RATE LIMITING
  // =========================================

  rateLimiting: {
    requestDelayMin: 1500,
    requestDelayMax: 3000,
    iterationDelay: 2000, // Between flights
    itemDelay: 5000, // Between seasons/events
    maxRetries: 3,
    retryDelays: [5000, 15000, 30000],
    cooldownOn429: 120000,
    cooldownOn500: 60000,
  },

  // =========================================
  // USER AGENTS
  // =========================================

  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  ],

  // =========================================
  // ENDPOINTS
  // =========================================

  endpoints: {
    acceptedList:
      "/tour/public/info/accepted_list.asp?sessionguid=&tournamentguid={tournamentGuid}",
    schedule:
      "/tour/public/info/schedule_results2.asp?sessionguid=&flightguid={flightGuid}&tournamentguid={tournamentGuid}",
  },

  // =========================================
  // PARSING CONFIGURATION
  // =========================================

  parsing: {
    dateFormat: "MMMM DD, YYYY", // "September 06, 2025"
    scoreRegex: /^(\d+)$/,
  },

  // =========================================
  // MATCH KEY FORMAT
  // =========================================

  matchKeyFormat: "sportsaffinity-{matchId}",

  // =========================================
  // EVENT DISCOVERY
  // =========================================

  discovery: {
    /**
     * Georgia Soccer seasons on SportsAffinity.
     * Each season has a subdomain and tournament GUID.
     * Current season (2025-26) = Fall 2025 + Spring 2026.
     */
    staticEvents: [
      {
        id: "fall2025",
        name: "Georgia Soccer Fall 2025 GPL",
        type: "league",
        year: 2026,
        state: "GA",
        subdomain: "gs-fall25gplacadathclrias",
        tournamentGuid: "E7A6731D-D5FF-41B4-9C3C-300ECEE69150",
      },
      {
        id: "spring2026",
        name: "Georgia Soccer Spring 2026 GPL",
        type: "league",
        year: 2026,
        state: "GA",
        subdomain: "gs",
        tournamentGuid: "CE35DE7A-39D2-40C0-BA3B-2A46C862535C",
      },
      {
        id: "spring2025",
        name: "Georgia Soccer Spring 2025 GPL",
        type: "league",
        year: 2025,
        state: "GA",
        subdomain: "gs-spr25acadathclrias",
        tournamentGuid: "6F94BCCC-EAAD-4369-8598-ECDF00068393",
      },
      {
        id: "fall2024",
        name: "Georgia Soccer Fall 2024 GPL",
        type: "league",
        year: 2025,
        state: "GA",
        subdomain: "gs-fall24gplacadathclrias",
        tournamentGuid: "7336D9D7-3A6F-46FD-9A85-D263981782DF",
      },

      // =============================================
      // MINNESOTA (mnyouth.sportsaffinity.com)
      // =============================================
      {
        id: "mn-fall2025",
        name: "MYSA Fall 2025 Competitive League",
        type: "league",
        year: 2026,
        state: "MN",
        subdomain: "mnyouth",
        tournamentGuid: "49165B3E-8218-4FDF-9F4F-7E726C932B5A",
      },
      {
        id: "mn-fall2025-metro",
        name: "MYSA 2025 Metro Alliance League",
        type: "league",
        year: 2026,
        state: "MN",
        subdomain: "mnyouth",
        tournamentGuid: "B8755BF4-5BC9-4CEE-83D6-B2BA1C1CE163",
      },
      {
        id: "mn-summer2025",
        name: "MYSA Summer Competitive League 2025",
        type: "league",
        year: 2026,
        state: "MN",
        subdomain: "mnyouth",
        tournamentGuid: "10E7EE95-9FEF-4E28-A531-9C13CBC17808",
      },
      {
        id: "mn-summer2026",
        name: "MYSA Summer Competitive League 2026",
        type: "league",
        year: 2026,
        state: "MN",
        subdomain: "mnyouth",
        tournamentGuid: "E25F0B1C-C8CF-4B17-852D-5B1B093E0C58",
      },

      // =============================================
      // UTAH (uysa.sportsaffinity.com)
      // =============================================
      {
        id: "ut-fall2025-premier",
        name: "UYSA Fall 2025 PL/SCL/IRL/XL",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "B1440B92-106F-4579-AE1C-A29255DD6DAD",
      },
      {
        id: "ut-fall2025-suirl",
        name: "UYSA Fall 2025 SUIRL",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "8AD6B40E-C9B3-4934-A804-52CA3D3B901A",
      },
      {
        id: "ut-fall2025-uvcl",
        name: "Utah Valley Competition League Fall 2025",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "F324B666-FD37-4000-89CF-1F17DDED8241",
      },
      {
        id: "ut-fall2025-ydl",
        name: "UYSA Fall 2025 YDL Academy",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "E03CCD96-C438-44C4-8FE8-85E2C07DE53C",
      },
      {
        id: "ut-fall2025-platform",
        name: "Utah Platform League 25-26",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "88F51363-3CEF-49B7-8FEE-477E8E2B2EF2",
      },
      {
        id: "ut-fall2025-challenger",
        name: "UYSA Challenger Fall 2025",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "7C612FE5-DFC6-48B9-9D23-2A603F383ACE",
      },
      {
        id: "ut-spring2026-premier",
        name: "UYSA Spring 2026 PL/SCL/IRL/XL",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "5E854765-1884-4512-BA43-3CBED9A49BC9",
      },
      {
        id: "ut-spring2026-challenger",
        name: "UYSA Spring 2026 Challenger League",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "1052F339-7E6A-467F-AA3E-69A32F9CF219",
      },
      {
        id: "ut-spring2026-uvcl",
        name: "Utah Valley Competition League Spring 2026",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "683829D2-6446-44E1-97CB-758E8748FB43",
      },
      {
        id: "ut-spring2026-suirl",
        name: "UYSA Spring 2026 SUIRL",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "7D33FD32-99F9-47D5-BA19-E2B247566E97",
      },
      {
        id: "ut-spring2026-scsl",
        name: "SCSL 2026 Spring League",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "B35FF30A-45B5-47EC-AE03-D1273B19BF44",
      },
      {
        id: "ut-spring2026-ydl",
        name: "UYSA Spring 2026 YDL Academy",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "320E89B9-73C3-4AC7-91DF-F4C306B033E4",
      },
      {
        id: "ut-spring2026-laroca",
        name: "La Roca Juniors Spring 2026",
        type: "league",
        year: 2026,
        state: "UT",
        subdomain: "uysa",
        tournamentGuid: "7F128065-C47D-4638-956F-F22A8E330908",
      },

      // =============================================
      // OREGON (oysa.sportsaffinity.com)
      // =============================================
      {
        id: "or-fall2025-league",
        name: "OYSA Fall League 2025",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "014D6282-E344-410E-81BB-8FDF842C270E",
      },
      {
        id: "or-fall2025-dev",
        name: "OYSA Fall Development League 2025",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "DD8356BF-1DB6-451E-BED5-014F88C5BC42",
      },
      {
        id: "or-fall2025-founders",
        name: "Fall Founders Cup OR 2025",
        type: "tournament",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "8AE17B27-4E68-41F1-9704-B23C12CF5EDD",
      },
      {
        id: "or-fall2025-valley",
        name: "Fall Valley Academy League 2025",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "AB3EFE9B-2B89-47D1-AE9D-F560C4536956",
      },
      {
        id: "or-fall2025-soccer5",
        name: "Soccer 5 Fall 2025",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "5CB295DF-33F7-4F3D-98EC-6FAD4D705ACC",
      },
      {
        id: "or-fall2025-pysa",
        name: "PYSA Fall 2025",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "EA5D5116-5F90-46BD-9948-C4DF09D6D28B",
      },
      {
        id: "or-spring2026-league",
        name: "OYSA Spring League 2026",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "2A349A09-F127-445D-9252-62C4D1029140",
      },
      {
        id: "or-spring2026-south",
        name: "OYSA Spring League South 2026",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "D07BB454-E1CA-42C9-837D-DADFAADD9FCF",
      },
      {
        id: "or-winter2026",
        name: "OYSA Winter League 2026",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "72AD07B7-EE2C-43F5-9108-EDEB82F6B58A",
      },
      {
        id: "or-spring2026-pysa",
        name: "PYSA Spring 2026",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "778D98BC-B965-4920-866C-4DC51712D0DD",
      },
      {
        id: "or-spring2026-founders",
        name: "Spring Founders Cup OR 2026",
        type: "tournament",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "451BEF64-5474-49E9-8FF1-7B1DABE1E3EA",
      },
      {
        id: "or-spring2026-dev",
        name: "OYSA Spring Development League 2026",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "B7972C4B-4CA9-4F0F-91A2-6859C6AA36A2",
      },
      {
        id: "or-spring2026-soccer5",
        name: "Soccer 5 Spring 2026",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "0607DE2A-47F2-448A-BB7F-ABA959993487",
      },
      {
        id: "or-spring2026-valley",
        name: "Spring Valley Academy League 2026",
        type: "league",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "5CDA2778-13D0-4E1D-BDC1-6EE6F3161633",
      },
      {
        id: "or-presidents-cup-2526",
        name: "Presidents Cup OR 25-26",
        type: "tournament",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "B8FAC66F-0871-45AB-A909-89A2FE719FF5",
      },
      {
        id: "or-state-cup-2526",
        name: "State Cup OR 25-26",
        type: "tournament",
        year: 2026,
        state: "OR",
        subdomain: "oysa",
        tournamentGuid: "789AF058-A919-4067-BB41-FB72BE118847",
      },

      // =============================================
      // NEBRASKA (nebraskasoccer.sportsaffinity.com)
      // =============================================
      {
        id: "ne-fall2025-premier",
        name: "NYSL Fall 2025 Premier Conference",
        type: "league",
        year: 2026,
        state: "NE",
        subdomain: "nebraskasoccer",
        tournamentGuid: "FE3A0D9E-1C57-4E13-A7D0-5DEDDA7A15AD",
      },
      {
        id: "ne-fall2025-dev",
        name: "NYSL Fall 2025 Developmental Conference",
        type: "league",
        year: 2026,
        state: "NE",
        subdomain: "nebraskasoccer",
        tournamentGuid: "E5D0230C-754E-4EAA-B2E9-C43A9DB9F5E1",
      },
      {
        id: "ne-fall2025-cysl",
        name: "CYSL Fall 2025",
        type: "league",
        year: 2026,
        state: "NE",
        subdomain: "nebraskasoccer",
        tournamentGuid: "CEB7B8AD-0231-456A-A776-5C59D564100B",
      },
      {
        id: "ne-fall2025-cornhusker",
        name: "NYSL Cornhusker Clash 2025",
        type: "tournament",
        year: 2026,
        state: "NE",
        subdomain: "nebraskasoccer",
        tournamentGuid: "54484833-76F8-40C0-9A8B-81A253BE259A",
      },
      {
        id: "ne-spring2026-nysl",
        name: "Nebraska Youth Soccer League Spring 2026",
        type: "league",
        year: 2026,
        state: "NE",
        subdomain: "nebraskasoccer",
        tournamentGuid: "17073438-1E6C-45B6-80C9-A59D5E670EFF",
      },
      {
        id: "ne-spring2026-premier-cup",
        name: "NYSL Premier Cup 2026",
        type: "tournament",
        year: 2026,
        state: "NE",
        subdomain: "nebraskasoccer",
        tournamentGuid: "A83E1B5D-0929-47CB-B48D-3076BB91677C",
      },
      {
        id: "ne-spring2026-cysl",
        name: "CYSL Spring 2026",
        type: "league",
        year: 2026,
        state: "NE",
        subdomain: "nebraskasoccer",
        tournamentGuid: "7F87869B-3C46-4DB9-8649-E6FFF66CEB3C",
      },
      {
        id: "ne-martinez-memorial-2026",
        name: "Andrew Martinez Memorial Tournament 2026",
        type: "tournament",
        year: 2026,
        state: "NE",
        subdomain: "nebraskasoccer",
        tournamentGuid: "6BA6442D-F610-4B56-BB3B-678EAC81577B",
      },

      // =============================================
      // PA-WEST (pawest.sportsaffinity.com)
      // NOTE: GLC/NAL/E64 removed — registration-only portal (UnPublishedPage.asp).
      // Match data for these national programs lives on GotSport:
      //   GLC = USYS NL Great Lakes Conference (events 50944/50937/50922)
      //   NAL = National Academy League (event 45671)
      //   E64 = USYS NL Club Premier 1 (events 50936-50942)
      // =============================================
      {
        id: "paw-fall2025-classic",
        name: "PA West Fall 2025 Classic League",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "0469921C-8341-41A6-B6B8-98ECA003257F",
      },
      {
        id: "paw-fall2025-frontier",
        name: "PA West Fall 2025 Frontier League",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "147BB7AF-04CD-4B64-9044-E67A29DF763B",
      },
      {
        id: "paw-fall2025-div4",
        name: "PA West Fall 2025 Division 4 Travel",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "9F381880-ED51-46C9-BBCD-8FE53DF1666C",
      },
      {
        id: "paw-fall2025-d1-east",
        name: "PA West Fall 2025 District 1 East",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "2C86A476-E113-4ABF-8015-E49F32BF8415",
      },
      {
        id: "paw-fall2025-d2-north",
        name: "PA West Fall 2025 District 2 North",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "42453A0D-A07F-4E52-B175-39BD599905B9",
      },
      {
        id: "paw-fall2025-d3-west",
        name: "PA West Fall 2025 District 3 West",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "81F5E980-B595-43E3-9E00-3942459DF6D6",
      },
      {
        id: "paw-fall2025-d4-south",
        name: "PA West Fall 2025 District 4 South",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "A8491BD7-89B1-4FF4-9B1B-C0F11FB16B7A",
      },
      {
        id: "paw-fall2025-d5-mountain",
        name: "PA West Fall 2025 District 5 Mountain",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "3905C84D-49DE-4E95-9C6F-A5B877C8606B",
      },
      {
        id: "paw-fall2025-d7-lake",
        name: "PA West Fall 2025 District 7 Lake",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "4B00C05F-CE01-44F4-A7F8-B984F12493BB",
      },
      {
        id: "paw-spring2026-classic",
        name: "PA West Spring 2026 Classic League",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "289045CB-66E7-46B9-8EE8-6D31F3361119",
      },
      {
        id: "paw-spring2026-div4",
        name: "PA West Spring 2026 Division 4 Travel",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "96D3901D-BC97-40AA-BCFE-FEA3B371EFAA",
      },
      {
        id: "paw-spring2026-d1-east",
        name: "PA West Spring 2026 District 1 East",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "F3997F36-D207-4874-9C99-3667C0436A80",
      },
      {
        id: "paw-spring2026-d2-north",
        name: "PA West Spring 2026 District 2 North",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "0783ABAF-F06D-44E7-BCA3-6D98FDB23EA9",
      },
      {
        id: "paw-spring2026-d3-west",
        name: "PA West Spring 2026 District 3 West",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "0A0FEAF6-FBCE-49E9-B557-86851DF92C31",
      },
      {
        id: "paw-spring2026-d4-south",
        name: "PA West Spring 2026 District 4 South",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "DA351D5D-5D2E-4687-8BED-7EF9BD5DE7C9",
      },
      {
        id: "paw-spring2026-d5-mountain",
        name: "PA West Spring 2026 District 5 Mountain",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "3E812E1D-570D-44FD-8EE9-27873774816C",
      },
      {
        id: "paw-spring2026-d7-lake",
        name: "PA West Spring 2026 District 7 Lake",
        type: "league",
        year: 2026,
        state: "PA",
        subdomain: "pawest",
        tournamentGuid: "22EB0AD6-57AD-405A-8FA2-F1BE387D0934",
      },
      // ========================
      // IOWA (2025isl-fall.sportsaffinity.com)
      // ========================
      {
        id: "ia-fall2025",
        name: "ISL State League Fall 2025",
        type: "league",
        year: 2026,
        state: "IA",
        subdomain: "2025isl-fall",
        tournamentGuid: "7762C9F4-A026-4A96-A540-2A260EAFA669",
      },
      {
        id: "ia-spring2025",
        name: "ISL State League Spring 2025",
        type: "league",
        year: 2025,
        state: "IA",
        subdomain: "2025isl-spring",
        tournamentGuid: "627614EC-DC51-43A5-B273-A972616BD454",
      },

      // =============================================
      // HAWAII (ol-*.sportsaffinity.com — Oahu League)
      // =============================================
      {
        id: "hi-fall2025",
        name: "Oahu League Fall 2025/26 Season",
        type: "league",
        year: 2026,
        state: "HI",
        subdomain: "ol-fall-25-26",
        tournamentGuid: "AD6E28FC-3EBE-46E9-842B-66E6A2EEB086",
      },
      {
        id: "hi-spring2026",
        name: "Oahu League Spring 2025/26 Season",
        type: "league",
        year: 2026,
        state: "HI",
        subdomain: "ol-spring-25-26",
        tournamentGuid: "94D44303-F331-4505-92B2-813593B3FC50",
      },
      {
        id: "hi-fall2024",
        name: "Oahu League Fall 2024/25 Season",
        type: "league",
        year: 2025,
        state: "HI",
        subdomain: "ol-fallcomp24-25",
        tournamentGuid: "9D2ADF88-D5D4-40EC-BD31-CE0FF1DCAEAB",
      },
      {
        id: "hi-spring2025",
        name: "Oahu League Spring 2024/25 Season",
        type: "league",
        year: 2025,
        state: "HI",
        subdomain: "ol-springcomp24-25",
        tournamentGuid: "896296D9-741D-4FFB-8B32-4BB6C07D274E",
      },
    ],

    discoverEvents: null,
  },

  // =========================================
  // DATA TRANSFORMATION
  // =========================================

  transform: {
    normalizeTeamName: (name) => {
      if (!name) return "";
      // Remove leading group codes: "A1 : Team Name" → "Team Name"
      return name.replace(/^[A-Z]\d+\s*:\s*/, "").trim();
    },

    parseDivision: (divisionText) => {
      if (!divisionText)
        return { gender: null, ageGroup: null };

      let gender = null;
      // SportsAffinity uses B12, B13, G12, G13 format (agecode)
      if (/\bB\d/i.test(divisionText) || /\bBoys?\b/i.test(divisionText))
        gender = "Boys";
      if (/\bG\d/i.test(divisionText) || /\bGirls?\b/i.test(divisionText))
        gender = "Girls";

      let ageGroup = null;
      // Extract age: B12 → U12, G14 → U14, or "12UB" → U12
      const ageMatch = divisionText.match(
        /[BG](\d{1,2})\b|\b(\d{1,2})U[BG]\b/i
      );
      if (ageMatch) {
        const age = ageMatch[1] || ageMatch[2];
        ageGroup = `U${age}`;
      }

      return { gender, ageGroup };
    },

    /** State inferred from event.state (set in staticEvents config) */
    inferState: () => null,

    /**
     * Parse date from "Month Day, Year" format.
     * Example: "September 06, 2025" → "2025-09-06"
     */
    parseDate: (dateStr) => {
      if (!dateStr) return null;
      const MONTHS = {
        January: "01",
        February: "02",
        March: "03",
        April: "04",
        May: "05",
        June: "06",
        July: "07",
        August: "08",
        September: "09",
        October: "10",
        November: "11",
        December: "12",
      };
      const m = dateStr.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
      if (!m) return null;
      const month = MONTHS[m[1]];
      if (!month) return null;
      return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
    },

    parseScore: (scoreStr) => {
      if (!scoreStr || scoreStr.trim() === "") return [null, null];
      const val = parseInt(scoreStr.trim(), 10);
      if (isNaN(val)) return [null, null];
      return val;
    },
  },

  // =========================================
  // CHECKPOINT CONFIG
  // =========================================

  checkpoint: {
    filename: ".sportsaffinity_checkpoint.json",
    saveAfterEachItem: true,
  },

  // =========================================
  // DATA POLICY
  // =========================================

  dataPolicy: {
    minDate: "2024-08-01",
    maxFutureDate: null,

    isValidMatch: (match) => {
      if (!match.homeTeamName || !match.awayTeamName) return false;
      if (match.homeTeamName === match.awayTeamName) return false;
      if (match.homeTeamName.toLowerCase() === "tbd") return false;
      if (match.awayTeamName.toLowerCase() === "tbd") return false;
      return true;
    },
  },

  // =========================================
  // CUSTOM SCRAPING LOGIC
  // =========================================

  scrapeEvent: async (engine, event) => {
    const allMatches = [];
    const subdomain = event.subdomain;
    const tournamentGuid = event.tournamentGuid;
    const baseUrl = `https://${subdomain}.sportsaffinity.com/tour/public/info`;

    console.log(`   Subdomain: ${subdomain}`);
    console.log(`   Tournament GUID: ${tournamentGuid}`);

    // Step 1: Discover all flights from accepted_list.asp
    const acceptedUrl = `${baseUrl}/accepted_list.asp?sessionguid=&tournamentguid=${tournamentGuid}`;
    console.log(`   Discovering flights...`);

    const { $: $acc, error: accError } =
      await engine.fetchWithCheerio(acceptedUrl);

    if (accError || !$acc) {
      console.error(
        `   Failed to fetch accepted list: ${accError || "empty response"}`
      );
      return [];
    }

    // Extract flights: agecode + flightguid from links
    const flights = [];
    const seenGuids = new Set();

    $acc('a[href*="flightguid"]').each((_, a) => {
      const href = $acc(a).attr("href") || "";
      const flightMatch = href.match(/flightguid=([A-F0-9-]+)/i);
      const ageMatch = href.match(/agecode=([A-Z]\d+)/i);
      if (!flightMatch) return;

      const guid = flightMatch[1].toUpperCase();
      if (seenGuids.has(guid)) return;
      seenGuids.add(guid);

      flights.push({
        guid,
        agecode: ageMatch ? ageMatch[1] : null,
      });
    });

    // Also extract flight names from <td> cells that contain age group info
    // Pattern: "12UB Pre GPL", "13UB GPL", "14UB Champ/Conf. North"
    const flightNames = new Map();
    $acc("td").each((_, td) => {
      const text = $acc(td).text().trim();
      const nameMatch = text.match(
        /^(\d{1,2}U[BG])\s+(.+)/i
      );
      if (nameMatch) {
        // Find the closest flight link in the same row
        const row = $acc(td).closest("tr");
        const link = row.find('a[href*="flightguid"]').first();
        if (link.length) {
          const href = link.attr("href") || "";
          const fm = href.match(/flightguid=([A-F0-9-]+)/i);
          if (fm) {
            flightNames.set(fm[1].toUpperCase(), text);
          }
        }
      }
    });

    // Enrich flights with names
    for (const flight of flights) {
      flight.name =
        flightNames.get(flight.guid) || flight.agecode || "Unknown";
    }

    console.log(`   Found ${flights.length} flights`);
    for (const f of flights) {
      console.log(`     ${f.agecode || "?"}: ${f.name} (${f.guid.substring(0, 8)}...)`);
    }

    // Step 2: For each flight, fetch schedule_results2.asp and parse matches
    for (let i = 0; i < flights.length; i++) {
      const flight = flights[i];
      console.log(
        `\n   [${i + 1}/${flights.length}] ${flight.name} (${flight.agecode})`
      );

      try {
        const matches = await scrapeFlight(
          engine,
          baseUrl,
          tournamentGuid,
          flight,
          event
        );

        if (matches.length > 0) {
          allMatches.push(...matches);
          console.log(`   ${flight.name}: ${matches.length} matches`);
        } else {
          console.log(`   ${flight.name}: 0 matches`);
        }
      } catch (error) {
        console.error(
          `   Error scraping ${flight.name}: ${error.message}`
        );
      }

      if (i < flights.length - 1) {
        await engine.sleep(engine.adapter.rateLimiting.iterationDelay);
      }
    }

    // Deduplicate by game number
    const uniqueMatches = Array.from(
      new Map(allMatches.map((m) => [m.matchId, m])).values()
    );

    console.log(
      `\n   Total: ${uniqueMatches.length} unique matches (${allMatches.length} raw)`
    );
    return uniqueMatches;
  },
};

// =========================================
// INTERNAL FUNCTIONS
// =========================================

const MONTHS = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
};

/**
 * Parse a date from "Month Day, Year" format to YYYY-MM-DD.
 */
function parseFullDate(month, day, year) {
  const mm = MONTHS[month];
  if (!mm) return null;
  return `${year}-${mm}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse gender and birth year from an agecode like "B12", "G14".
 */
function parseAgecode(agecode) {
  if (!agecode) return { gender: null, ageGroup: null, birthYear: null };

  const m = agecode.match(/^([BG])(\d{1,2})$/i);
  if (!m) return { gender: null, ageGroup: null, birthYear: null };

  const gender = m[1].toUpperCase() === "B" ? "Boys" : "Girls";
  const ageNum = parseInt(m[2], 10);
  const ageGroup = `U${ageNum}`;

  // Birth year: U12 in 2025-26 season = 2014 birth year (2026 - 12)
  const birthYear = 2026 - ageNum;

  return { gender, ageGroup, birthYear };
}

/**
 * Scrape all matches for one flight.
 * Fetches schedule_results2.asp and parses the HTML tables.
 *
 * Date association: Uses recursive DOM walk to find <b> date headers
 * and associate them with subsequent match tables.
 */
async function scrapeFlight(engine, baseUrl, tournamentGuid, flight, event) {
  const scheduleUrl = `${baseUrl}/schedule_results2.asp?sessionguid=&flightguid=${flight.guid}&tournamentguid=${tournamentGuid}`;

  const { $, html, error } = await engine.fetchWithCheerio(scheduleUrl);

  if (error || !$) {
    console.log(`     Failed to fetch schedule: ${error || "empty"}`);
    return [];
  }

  const { gender, ageGroup, birthYear } = parseAgecode(flight.agecode);

  // Strategy for date detection:
  // Walk the entire DOM tree depth-first. When we encounter a <b> with a date pattern,
  // save it as currentDate. When we encounter a match table, parse matches using currentDate.
  // This works because depth-first traversal follows document order.

  const matchesWithDates = [];
  let currentDate = null;

  function walkNode(node) {
    if (!node) return;

    // Check if this is a tag element
    if (node.type === "tag") {
      // Check for date header in <b> tags
      if (node.tagName === "b") {
        const text = $(node).text().trim();
        const dateMatch = text.match(
          /Bracket\s*-\s*\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/
        );
        if (dateMatch) {
          currentDate = parseFullDate(
            dateMatch[1],
            dateMatch[2],
            dateMatch[3]
          );
        }
      }

      // Check for match table
      if (node.tagName === "table") {
        const headerRow = $(node).find("tr").first();
        const headerText = headerRow.text();

        if (
          headerText.includes("Home Team") &&
          headerText.includes("Away Team")
        ) {
          // This is a match table — parse it
          $(node)
            .find("tr")
            .slice(1)
            .each((_, row) => {
              const cells = $(row).find("td");
              if (cells.length < 10) return;

              const gameNum = $(cells[0]).text().trim();
              const venue = $(cells[1]).text().trim();
              const time = $(cells[2]).text().trim();
              const field = $(cells[3]).text().trim();
              const group = $(cells[4]).text().trim();
              const homeTeam = $(cells[5]).text().trim();
              const homeScoreStr = $(cells[6]).text().trim();
              // cells[7] = "vs."
              const awayTeam = $(cells[8]).text().trim();
              const awayScoreStr = $(cells[9]).text().trim();

              if (!gameNum || !homeTeam || !awayTeam) return;

              matchesWithDates.push({
                gameNum,
                date: currentDate,
                time,
                venue,
                field,
                group,
                homeTeam,
                homeScoreStr,
                awayTeam,
                awayScoreStr,
              });
            });
        }
      }

      // Recurse into children
      const children = node.children || [];
      for (const child of children) {
        walkNode(child);
      }
    }
  }

  // Start walk from <body> (or root)
  const root = $("body")[0] || $.root()[0];
  if (root && root.children) {
    for (const child of root.children) {
      walkNode(child);
    }
  }

  // Transform to standard match format
  const matches = [];
  for (const m of matchesWithDates) {
    // Parse time: "09:00 AM" → "09:00"
    let matchTime = null;
    if (m.time) {
      const tm = m.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (tm) {
        let hours = parseInt(tm[1], 10);
        if (tm[3].toUpperCase() === "PM" && hours !== 12) hours += 12;
        if (tm[3].toUpperCase() === "AM" && hours === 12) hours = 0;
        matchTime = `${String(hours).padStart(2, "0")}:${tm[2]}`;
      }
    }

    // Parse scores
    const homeScore = m.homeScoreStr !== "" ? parseInt(m.homeScoreStr, 10) : null;
    const awayScore = m.awayScoreStr !== "" ? parseInt(m.awayScoreStr, 10) : null;
    const hasScore =
      homeScore !== null &&
      !isNaN(homeScore) &&
      awayScore !== null &&
      !isNaN(awayScore);

    const status = hasScore ? "completed" : "scheduled";

    // Build division string
    const division = [ageGroup, flight.name, m.group]
      .filter(Boolean)
      .join(" — ");

    matches.push({
      eventId: event.id,
      eventName: event.name,
      matchId: m.gameNum,
      matchDate: m.date || null,
      matchTime,
      homeTeamName: m.homeTeam,
      awayTeamName: m.awayTeam,
      homeScore: hasScore ? homeScore : null,
      awayScore: hasScore ? awayScore : null,
      homeId: null,
      awayId: null,
      status,
      location: [m.venue, m.field].filter(Boolean).join(" — "),
      division,
      gender,
      ageGroup,
      raw_data: {
        sportsaffinity_game_num: m.gameNum,
        flight_guid: flight.guid,
        agecode: flight.agecode,
        flight_name: flight.name,
        group_matchup: m.group,
        birth_year: birthYear,
      },
    });
  }

  return matches.filter((m) =>
    engine.adapter.dataPolicy.isValidMatch(m)
  );
}
