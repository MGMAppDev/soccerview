/**
 * Fix unknown-state teams across ALL sources
 * Infers state from team name using geographic keywords, state names, and city patterns
 * Covers ALL 50 US states + DC with major cities and soccer-relevant locations
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STATE_ABBR_RE = /^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$/;

// State names — longest first to avoid partial matches
const STATE_NAMES = [
  ['West Virginia', 'WV'], ['North Carolina', 'NC'], ['South Carolina', 'SC'],
  ['North Dakota', 'ND'], ['South Dakota', 'SD'], ['Rhode Island', 'RI'],
  ['New Hampshire', 'NH'], ['New Jersey', 'NJ'], ['New Mexico', 'NM'],
  ['New York', 'NY'], ['New England', 'MA'],
  ['District of Columbia', 'DC'],
  ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'],
  ['California', 'CA'], ['Colorado', 'CO'], ['Connecticut', 'CT'], ['Delaware', 'DE'],
  ['Florida', 'FL'], ['Georgia', 'GA'], ['Hawaii', 'HI'], ['Idaho', 'ID'],
  ['Illinois', 'IL'], ['Indiana', 'IN'], ['Iowa', 'IA'], ['Kansas', 'KS'],
  ['Kentucky', 'KY'], ['Louisiana', 'LA'], ['Maine', 'ME'], ['Maryland', 'MD'],
  ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'],
  ['Mississippi', 'MS'], ['Missouri', 'MO'], ['Montana', 'MT'],
  ['Nebraska', 'NE'], ['Nevada', 'NV'],
  ['Ohio', 'OH'], ['Oklahoma', 'OK'], ['Oregon', 'OR'],
  ['Pennsylvania', 'PA'], ['Tennessee', 'TN'], ['Texas', 'TX'],
  ['Utah', 'UT'], ['Vermont', 'VT'], ['Virginia', 'VA'],
  ['Washington', 'WA'], ['Wisconsin', 'WI'], ['Wyoming', 'WY'],
];

// Major cities and regions → state mapping (unambiguous only)
// Organized by state for maintainability
const AREA_STATE_MAP = [
  // AL
  [/\bBirmingham\b/i, 'AL'], [/\bHuntsville\b/i, 'AL'], [/\bMobile\b(?! )/i, 'AL'],
  [/\bMontgomery\b/i, 'AL'], [/\bTuscaloosa\b/i, 'AL'], [/\bHoover\b/i, 'AL'],
  // AZ
  [/\bPhoenix\b/i, 'AZ'], [/\bScottsdale\b/i, 'AZ'], [/\bTucson\b/i, 'AZ'],
  [/\bTempe\b/i, 'AZ'], [/\bMesa\b/i, 'AZ'], [/\bGilbert\b/i, 'AZ'],
  [/\bChandler\b/i, 'AZ'], [/\bGlendale\b(?!.*CA)/i, 'AZ'], [/\bPeoria\b/i, 'AZ'],
  // CA
  [/\bSan Diego\b/i, 'CA'], [/\bLos Angeles\b/i, 'CA'], [/\bSan Jose\b/i, 'CA'],
  [/\bSan Francisco\b/i, 'CA'], [/\bSacramento\b/i, 'CA'], [/\bOakland\b/i, 'CA'],
  [/\bIrvine\b/i, 'CA'], [/\bAnaheim\b/i, 'CA'], [/\bSanta Cruz\b/i, 'CA'],
  [/\bSanta Barbara\b/i, 'CA'], [/\bSanta Monica\b/i, 'CA'], [/\bSOCAL\b/i, 'CA'],
  [/\bNorCal\b/i, 'CA'], [/\bSoCal\b/i, 'CA'], [/\bCal North\b/i, 'CA'],
  [/\bChula Vista\b/i, 'CA'], [/\bFremont\b/i, 'CA'], [/\bBakersfield\b/i, 'CA'],
  [/\bRiverside\b/i, 'CA'], [/\bStockton\b/i, 'CA'], [/\bModesto\b/i, 'CA'],
  [/\bFresno\b/i, 'CA'], [/\bSan Mateo\b/i, 'CA'], [/\bSan Ramon\b/i, 'CA'],
  [/\bDanville\b/i, 'CA'], [/\bPleasanton\b/i, 'CA'], [/\bWalnut Creek\b/i, 'CA'],
  [/\bConcord\b/i, 'CA'], [/\bHayward\b/i, 'CA'], [/\bSunnyvale\b/i, 'CA'],
  [/\bPalo Alto\b/i, 'CA'], [/\bMountain View\b/i, 'CA'], [/\bRedwood\b/i, 'CA'],
  [/\bMarin\b/i, 'CA'], [/\bSonoma\b/i, 'CA'], [/\bNapa\b/i, 'CA'],
  [/\bBay Area\b/i, 'CA'], [/\bPeninsula\b/i, 'CA'], [/\bCerritos\b/i, 'CA'],
  [/\bTorrance\b/i, 'CA'], [/\bPomona\b/i, 'CA'], [/\bOntario\b/i, 'CA'],
  [/\bOxnard\b/i, 'CA'], [/\bVentura\b/i, 'CA'], [/\bSimi Valley\b/i, 'CA'],
  [/\bThousand Oaks\b/i, 'CA'], [/\bCarlsbad\b/i, 'CA'], [/\bEl Cajon\b/i, 'CA'],
  [/\bOceanside\b/i, 'CA'], [/\bVista\b(?! FC)/i, 'CA'], [/\bEscondido\b/i, 'CA'],
  [/\bTemecula\b/i, 'CA'], [/\bMurrieta\b/i, 'CA'], [/\bClovis\b/i, 'CA'],
  [/\bVisalia\b/i, 'CA'], [/\bSalinas\b/i, 'CA'], [/\bMonterey\b/i, 'CA'],
  [/\bSanta Rosa\b/i, 'CA'], [/\bPlacer\b/i, 'CA'], [/\bRoseville\b/i, 'CA'],
  [/\bElk Grove\b/i, 'CA'], [/\bFolsom\b/i, 'CA'], [/\bDavis\b(?! SC)/i, 'CA'],
  [/\bCentral Cal\b/i, 'CA'], [/\bSD North\b/i, 'CA'], [/\bSD South\b/i, 'CA'],
  [/\bAlbion SC\b(?!.*Las Vegas|.*LV|.*Vegas)/i, 'CA'], [/\bSurf SC\b|Surf Soccer\b/i, 'CA'],
  [/\bLegends FC\b/i, 'CA'], [/\bRayados.*San Diego\b/i, 'CA'],
  [/\bValley Surf\b/i, 'CA'], [/\bBeach FC\b/i, 'CA'],
  [/\bLA Galaxy\b|LAG\b/i, 'CA'], [/\bSan Juan\b/i, 'CA'],
  [/\bLA Surf\b/i, 'CA'], [/\bBrea\b/i, 'CA'], [/\bFullerton\b/i, 'CA'],
  // CO
  [/\bDenver\b/i, 'CO'], [/\bBoulder\b/i, 'CO'], [/\bColorado Springs\b/i, 'CO'],
  [/\bFort Collins\b/i, 'CO'], [/\bAurora\b/i, 'CO'], [/\bLakewood\b/i, 'CO'],
  [/\bLittleton\b/i, 'CO'], [/\bLongmont\b/i, 'CO'], [/\bBroomfield\b/i, 'CO'],
  [/\bCO Rapids\b/i, 'CO'],
  // CT
  [/\bHartford\b/i, 'CT'], [/\bNew Haven\b/i, 'CT'], [/\bStamford\b/i, 'CT'],
  [/\bBridgeport\b/i, 'CT'], [/\bWaterbury\b/i, 'CT'], [/\bDanbury\b/i, 'CT'],
  [/\bNorwalk\b/i, 'CT'], [/\bGreenwich\b/i, 'CT'],
  // DC
  [/\bDC United\b/i, 'DC'], [/\bDCWA\b/i, 'DC'],
  // DE
  [/\bWilmington\b/i, 'DE'], [/\bNewark\b.*DE\b/i, 'DE'], [/\bDover\b/i, 'DE'],
  // FL
  [/\bMiami\b/i, 'FL'], [/\bOrlando\b/i, 'FL'], [/\bTampa\b/i, 'FL'],
  [/\bJacksonville\b/i, 'FL'], [/\bFt\.? Lauderdale\b|Fort Lauderdale\b/i, 'FL'],
  [/\bNaples\b/i, 'FL'], [/\bSarasota\b/i, 'FL'], [/\bBoca Raton\b/i, 'FL'],
  [/\bPalm Beach\b/i, 'FL'], [/\bSt\.? Pete\b|Saint Petersburg\b/i, 'FL'],
  [/\bClearwater\b/i, 'FL'], [/\bGainesville\b/i, 'FL'], [/\bTallahassee\b/i, 'FL'],
  [/\bWeston\b/i, 'FL'], [/\bPembroke\b/i, 'FL'], [/\bCoral\b/i, 'FL'],
  [/\bDoral\b/i, 'FL'], [/\bKendall\b/i, 'FL'], [/\bHialeah\b/i, 'FL'],
  [/\bBraden\b/i, 'FL'], [/\bBrevard\b/i, 'FL'], [/\bVolusia\b/i, 'FL'],
  [/\bSouth FL\b|SFL\b/i, 'FL'], [/\bCentral FL\b/i, 'FL'],
  [/\bInter Miami\b/i, 'FL'], [/\bJuventus.*Miami\b/i, 'FL'],
  // GA
  [/\bAtlanta\b/i, 'GA'], [/\bSavannah\b/i, 'GA'], [/\bAugusta\b/i, 'GA'],
  [/\bMacon\b/i, 'GA'], [/\bAthens\b/i, 'GA'], [/\bMarietta\b/i, 'GA'],
  [/\bRoswell\b/i, 'GA'], [/\bAlpharetta\b/i, 'GA'], [/\bDuluth\b/i, 'GA'],
  [/\bLawrenceville\b/i, 'GA'], [/\bGwinnett\b/i, 'GA'], [/\bCobb\b/i, 'GA'],
  [/\bPeachtree\b/i, 'GA'], [/\bKennesaw\b/i, 'GA'], [/\bCanton\b(?!.*OH)/i, 'GA'],
  [/\bCumming\b/i, 'GA'], [/\bSuwanee\b/i, 'GA'], [/\bConyers\b/i, 'GA'],
  [/\bGeorgia\b/i, 'GA'],
  // HI
  [/\bHonolulu\b/i, 'HI'], [/\bOahu\b/i, 'HI'], [/\bMaui\b/i, 'HI'],
  // ID
  [/\bBoise\b/i, 'ID'], [/\bMeridian\b/i, 'ID'], [/\bNampa\b/i, 'ID'],
  [/\bIdaho Falls\b/i, 'ID'],
  // IL
  [/\bChicago\b/i, 'IL'], [/\bNaperville\b/i, 'IL'], [/\bElgin\b/i, 'IL'],
  [/\bSchaumburg\b/i, 'IL'], [/\bEvanston\b/i, 'IL'], [/\bArlington Heights\b/i, 'IL'],
  [/\bOrland Park\b/i, 'IL'], [/\bSkokie\b/i, 'IL'], [/\bTinley Park\b/i, 'IL'],
  [/\bChicago Fire\b/i, 'IL'],
  // IN
  [/\bIndianapolis\b|Indy\b/i, 'IN'], [/\bFort Wayne\b/i, 'IN'],
  [/\bCarmel\b/i, 'IN'], [/\bFishers\b/i, 'IN'], [/\bNoblesville\b/i, 'IN'],
  [/\bZionsville\b/i, 'IN'],
  // IA
  [/\bDes Moines\b/i, 'IA'], [/\bCedar Rapids\b/i, 'IA'], [/\bDavenport\b/i, 'IA'],
  [/\bSioux City\b/i, 'IA'],
  // KS
  [/\bWichita\b/i, 'KS'], [/\bOverland Park\b/i, 'KS'], [/\bOlathe\b/i, 'KS'],
  [/\bLenexa\b/i, 'KS'], [/\bShawnee\b(?!.*OK)/i, 'KS'],
  [/\bKaw Valley\b/i, 'KS'], [/\bSporting BV\b|Sporting Blue Valley\b/i, 'KS'],
  // KY
  [/\bLouisville\b/i, 'KY'], [/\bLexington\b/i, 'KY'], [/\bBowling Green\b/i, 'KY'],
  // LA
  [/\bBaton Rouge\b/i, 'LA'], [/\bNew Orleans\b/i, 'LA'], [/\bShreveport\b/i, 'LA'],
  [/\bLafayette\b/i, 'LA'],
  // ME
  [/\bBangor\b/i, 'ME'],
  // MD
  [/\bBaltimore\b/i, 'MD'], [/\bBethesda\b/i, 'MD'], [/\bPotomac\b/i, 'MD'],
  [/\bSilver Spring\b/i, 'MD'], [/\bRockville\b/i, 'MD'], [/\bSeverna Park\b/i, 'MD'],
  [/\bTowson\b/i, 'MD'], [/\bAnnapolis\b/i, 'MD'], [/\bGlen Burnie\b/i, 'MD'],
  [/\bCalvert\b/i, 'MD'], [/\bHoward\b/i, 'MD'], [/\bAnne Arundel\b/i, 'MD'],
  [/\bFrederick\b(?!.*sburg)/i, 'MD'], [/\bEllicott City\b/i, 'MD'],
  [/\bColumbia\b.*\bMD\b/i, 'MD'], [/\bOdenton\b/i, 'MD'],
  [/\bCarney\b/i, 'MD'], [/\bTimonium\b/i, 'MD'],
  [/\bOlney\b/i, 'MD'], [/\bGermantown\b/i, 'MD'],
  [/\bGaithersburg\b/i, 'MD'], [/\bBowie\b/i, 'MD'],
  [/\bHavre de Grace\b/i, 'MD'], [/\bSalisbury\b/i, 'MD'],
  [/\bChesapeake\b/i, 'MD'],
  // MA
  [/\bBoston\b/i, 'MA'], [/\bCambridge\b/i, 'MA'], [/\bWorcester\b/i, 'MA'],
  [/\bSpringfield\b(?!.*MO)/i, 'MA'], [/\bNewton\b/i, 'MA'],
  [/\bBrookline\b/i, 'MA'], [/\bCape Cod\b/i, 'MA'],
  [/\bNeedham\b/i, 'MA'], [/\bWellesley\b/i, 'MA'],
  // MI
  [/\bDetroit\b/i, 'MI'], [/\bGrand Rapids\b/i, 'MI'], [/\bAnn Arbor\b/i, 'MI'],
  [/\bLansing\b/i, 'MI'], [/\bKalamazoo\b/i, 'MI'], [/\bTroy\b/i, 'MI'],
  [/\bRochester Hills\b/i, 'MI'], [/\bSterling Heights\b/i, 'MI'],
  // MN
  [/\bMinneapolis\b/i, 'MN'], [/\bSt\.? Paul\b|Saint Paul\b/i, 'MN'],
  [/\bTwin Cities\b/i, 'MN'], [/\bMinnesota\b/i, 'MN'], [/\bMN Thunder\b/i, 'MN'],
  [/\bBloomington\b(?!.*IL)/i, 'MN'], [/\bEagan\b/i, 'MN'],
  [/\bMaple Grove\b/i, 'MN'], [/\bEdina\b/i, 'MN'], [/\bPlymouth\b(?!.*MI)/i, 'MN'],
  // MO
  [/\bSt\.? Louis\b|Saint Louis\b/i, 'MO'], [/\bSTL\b/i, 'MO'],
  [/\bSLYSA\b/i, 'MO'], [/\bJoplin\b/i, 'MO'],
  // MS
  [/\bJackson\b(?!.*ville)/i, 'MS'], [/\bGulfport\b/i, 'MS'],
  // MT
  [/\bBillings\b/i, 'MT'], [/\bMissoula\b/i, 'MT'], [/\bHelena\b/i, 'MT'],
  // NE
  [/\bOmaha\b/i, 'NE'], [/\bLincoln\b/i, 'NE'],
  // NV
  [/\bLas Vegas\b/i, 'NV'], [/\bHenderson\b/i, 'NV'], [/\bReno\b/i, 'NV'],
  [/\bSummerlin\b/i, 'NV'], [/\bSparks\b(?!.*SC)/i, 'NV'],
  [/\bLV Heat\b/i, 'NV'], [/\bVegas\b/i, 'NV'],
  // NH
  [/\bManchester\b(?!.*CT|.*UK|.*City|.*United)/i, 'NH'], [/\bNashua\b/i, 'NH'],
  // NJ
  [/\bPrinceton\b/i, 'NJ'], [/\bJersey\b/i, 'NJ'],
  [/\bMonmouth\b/i, 'NJ'], [/\bMercer\b/i, 'NJ'], [/\bBergen\b/i, 'NJ'],
  [/\bSomerset\b/i, 'NJ'], [/\bDeptford\b/i, 'NJ'], [/\bKearny\b/i, 'NJ'],
  [/\bEdgewater\b/i, 'NJ'], [/\bHoboken\b/i, 'NJ'],
  [/\bCherry Hill\b/i, 'NJ'], [/\bMoorestown\b/i, 'NJ'],
  [/\bMarlton\b/i, 'NJ'], [/\bMount Laurel\b/i, 'NJ'],
  [/\bToms River\b/i, 'NJ'], [/\bBrick\b/i, 'NJ'],
  [/\bCamden\b/i, 'NJ'], [/\bTrenton\b/i, 'NJ'],
  [/\bElizabeth\b/i, 'NJ'], [/\bJersey City\b/i, 'NJ'],
  [/\bHackensack\b/i, 'NJ'], [/\bParamus\b/i, 'NJ'],
  [/\bParsippany\b/i, 'NJ'], [/\bMorristown\b/i, 'NJ'],
  [/\bPDA\b/i, 'NJ'], // Players Development Academy
  [/\bLIJSL\b/i, 'NY'], // LIJSL is NY not NJ
  // NM
  [/\bAlbuquerque\b/i, 'NM'], [/\bSanta Fe\b/i, 'NM'], [/\bLas Cruces\b/i, 'NM'],
  // NY
  [/\bLong Island\b/i, 'NY'], [/\bBrooklyn\b/i, 'NY'], [/\bQueens\b/i, 'NY'],
  [/\bBronx\b/i, 'NY'], [/\bManhattan\b/i, 'NY'], [/\bStaten Island\b/i, 'NY'],
  [/\bWestchester\b/i, 'NY'], [/\bSyracuse\b/i, 'NY'], [/\bBuffalo\b/i, 'NY'],
  [/\bRochester\b(?!.*Hills)/i, 'NY'], [/\bAlbany\b/i, 'NY'],
  [/\bYonkers\b/i, 'NY'], [/\bNew Rochelle\b/i, 'NY'],
  [/\bSuffolk\b/i, 'NY'], [/\bNassau\b/i, 'NY'],
  [/\bGarden City\b.*LIJSL\b/i, 'NY'],
  [/\bNYC\b/i, 'NY'], [/\bNYRB\b/i, 'NY'], // NY Red Bulls
  // NC
  [/\bCharlotte\b/i, 'NC'], [/\bRaleigh\b/i, 'NC'], [/\bDurham\b/i, 'NC'],
  [/\bGreensboro\b/i, 'NC'], [/\bWilmington\b(?!.*DE)/i, 'NC'],
  [/\bCary\b/i, 'NC'], [/\bApex\b/i, 'NC'], [/\bTriangle\b/i, 'NC'],
  [/\bWake\b/i, 'NC'],
  // OH
  [/\bCleveland\b/i, 'OH'], [/\bColumbus\b(?!.*GA)/i, 'OH'], [/\bCincinnati\b/i, 'OH'],
  [/\bAkron\b/i, 'OH'], [/\bDayton\b/i, 'OH'], [/\bToledo\b/i, 'OH'],
  [/\bCanton\b(?!.*GA)/i, 'OH'], [/\bYoungstown\b/i, 'OH'],
  [/\bCrew SC\b/i, 'OH'],
  // OK
  [/\bOklahoma City\b|OKC\b/i, 'OK'], [/\bTulsa\b/i, 'OK'], [/\bNorman\b/i, 'OK'],
  [/\bEdmond\b/i, 'OK'], [/\bBroken Arrow\b/i, 'OK'],
  // OR
  [/\bPortland\b/i, 'OR'], [/\bBeaverton\b/i, 'OR'],
  [/\bEugene\b/i, 'OR'], [/\bSalem\b/i, 'OR'], [/\bHillsboro\b/i, 'OR'],
  [/\bTigard\b/i, 'OR'], [/\bTimbers\b/i, 'OR'],
  // PA
  [/\bPhiladelphia\b|\bPhilly\b/i, 'PA'], [/\bPittsburgh\b/i, 'PA'],
  [/\bLancaster\b/i, 'PA'], [/\bBucks County\b/i, 'PA'],
  [/\bAllentown\b/i, 'PA'], [/\bBethlehem\b/i, 'PA'],
  [/\bReading\b/i, 'PA'], [/\bScranton\b/i, 'PA'],
  [/\bErie\b/i, 'PA'], [/\bParkland\b/i, 'PA'],
  // RI
  [/\bProvidence\b/i, 'RI'], [/\bWarwick\b/i, 'RI'], [/\bCranston\b/i, 'RI'],
  // SC
  [/\bCharleston\b/i, 'SC'], [/\bColumbia\b(?!.*OH|.*MD)/i, 'SC'],
  [/\bGreenville\b/i, 'SC'], [/\bMyrtle Beach\b/i, 'SC'],
  // SD
  [/\bSioux Falls\b/i, 'SD'], [/\bRapid City\b/i, 'SD'],
  [/\bBlack Hills\b/i, 'SD'],
  // TN
  [/\bNashville\b/i, 'TN'], [/\bMemphis\b/i, 'TN'], [/\bKnoxville\b/i, 'TN'],
  [/\bChattanooga\b/i, 'TN'], [/\bClarksville\b/i, 'TN'],
  [/\bFranklin\b/i, 'TN'], [/\bMurfreesboro\b/i, 'TN'],
  // TX
  [/\bDallas\b/i, 'TX'], [/\bHouston\b/i, 'TX'], [/\bSan Antonio\b/i, 'TX'],
  [/\bAustin\b/i, 'TX'], [/\bFort Worth\b|Ft\.? Worth\b/i, 'TX'],
  [/\bEl Paso\b/i, 'TX'], [/\bPlano\b/i, 'TX'], [/\bFrisco\b/i, 'TX'],
  [/\bMcKinney\b/i, 'TX'], [/\bAllen\b(?! SC)/i, 'TX'], [/\bDenton\b/i, 'TX'],
  [/\bLewisville\b/i, 'TX'], [/\bRichardson\b/i, 'TX'], [/\bSugar Land\b/i, 'TX'],
  [/\bKaty\b/i, 'TX'], [/\bWoodlands\b/i, 'TX'], [/\bPearland\b/i, 'TX'],
  [/\bRound Rock\b/i, 'TX'], [/\bGeorgetown\b/i, 'TX'], [/\bPflugerville\b/i, 'TX'],
  [/\bCedar Park\b/i, 'TX'], [/\bLaredo\b/i, 'TX'], [/\bCorpus Christi\b/i, 'TX'],
  [/\bLubbock\b/i, 'TX'], [/\bAmarillo\b/i, 'TX'], [/\bMidland\b/i, 'TX'],
  [/\bTexans\b/i, 'TX'], [/\bSolar SC\b/i, 'TX'], [/\bFC Dallas\b/i, 'TX'],
  [/\bLonestar\b|Lone Star\b/i, 'TX'], [/\bDFW\b/i, 'TX'],
  [/\bAtletico Dallas\b|Atletico Dallas\b/i, 'TX'], [/\bDallas Cosmos\b/i, 'TX'],
  [/\bDallas Texans\b/i, 'TX'], [/\bClay County\b/i, 'TX'],
  // UT
  [/\bSalt Lake\b/i, 'UT'], [/\bProvo\b/i, 'UT'], [/\bOgden\b/i, 'UT'],
  [/\bSt\.? George\b|Saint George\b/i, 'UT'], [/\bOrem\b/i, 'UT'],
  [/\bReal Salt Lake\b/i, 'UT'], [/\bRSL\b(?!-AZ)/i, 'UT'], [/\bSandy\b.*UT\b/i, 'UT'],
  // VT
  [/\bBurlington\b/i, 'VT'], [/\bMontpelier\b/i, 'VT'],
  // VA
  [/\bArlington\b/i, 'VA'], [/\bFairfax\b/i, 'VA'], [/\bLoudoun\b/i, 'VA'],
  [/\bWoodbridge\b/i, 'VA'], [/\bManassas\b/i, 'VA'], [/\bChantilly\b/i, 'VA'],
  [/\bReston\b/i, 'VA'], [/\bAlexandria\b/i, 'VA'], [/\bSterling\b/i, 'VA'],
  [/\bLeesburg\b/i, 'VA'], [/\bHerndon\b/i, 'VA'], [/\bVirginia Beach\b/i, 'VA'],
  [/\bNorfolk\b/i, 'VA'], [/\bRichmond\b/i, 'VA'], [/\bCharlottesville\b/i, 'VA'],
  [/\bMcLean\b/i, 'VA'], [/\bGreat Falls\b/i, 'VA'],
  [/\bFredericksburg\b/i, 'VA'], [/\bVienna\b/i, 'VA'],
  // WA
  [/\bSeattle\b/i, 'WA'], [/\bTacoma\b/i, 'WA'], [/\bBellevue\b/i, 'WA'],
  [/\bSpokane\b/i, 'WA'], [/\bRedmond\b/i, 'WA'], [/\bKirkland\b/i, 'WA'],
  [/\bOlympia\b/i, 'WA'], [/\bSounders\b/i, 'WA'], [/\bFederal Way\b/i, 'WA'],
  // WI
  [/\bMilwaukee\b/i, 'WI'], [/\bMadison\b/i, 'WI'], [/\bGreen Bay\b/i, 'WI'],
  [/\bAppleton\b/i, 'WI'], [/\bOshkosh\b/i, 'WI'],
  // WV
  [/\bCharleston\b.*WV\b/i, 'WV'], [/\bMorgantown\b/i, 'WV'],
];

// Ambiguous cities — SKIP (could be multiple states)
// "Kansas City" → KS or MO
// "Portland" → OR or ME (handled with exclusion patterns above)
// "Springfield" → IL, MA, MO, OH — skip
// "Arlington" → VA or TX — default VA (more soccer-relevant)
// "Columbia" → SC, OH, MD — handled with exclusion patterns

function inferState(name) {
  // 1. Parenthetical state: "(MD)", "(NJ)"
  const parenMatch = name.match(/\(([A-Z]{2})\)/);
  if (parenMatch && STATE_ABBR_RE.test(parenMatch[1])) return parenMatch[1];

  // 2. State names in team name (longest match first)
  for (const [stateName, abbr] of STATE_NAMES) {
    if (name.includes(stateName)) return abbr;
  }

  // 3. Geographic keywords
  for (const [pattern, abbr] of AREA_STATE_MAP) {
    if (pattern.test(name)) return abbr;
  }

  // 4. Trailing state abbreviation: "Team Name TX"
  const endMatch = name.match(/\b([A-Z]{2})$/);
  if (endMatch && STATE_ABBR_RE.test(endMatch[1])) return endMatch[1];

  // 5. State abbreviation in parentheses or after dash at end: "Team - VA", "Team VA"
  const dashMatch = name.match(/[-–]\s*([A-Z]{2})\s*$/);
  if (dashMatch && STATE_ABBR_RE.test(dashMatch[1])) return dashMatch[1];

  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('SELECT authorize_pipeline_write()');

    const { rows: unknownTeams } = await client.query(`
      SELECT id, display_name FROM teams_v2
      WHERE state IN ('unknown', 'Unknown')
    `);

    console.log(`Total unknown-state teams: ${unknownTeams.length}`);
    if (dryRun) console.log('DRY RUN — no changes will be made\n');

    let fixed = 0, skipped = 0;
    const stateUpdates = {};
    const samples = {}; // Track sample matches per state

    for (const team of unknownTeams) {
      const state = inferState(team.display_name);
      if (state) {
        if (dryRun) {
          stateUpdates[state] = (stateUpdates[state] || 0) + 1;
          if (!samples[state]) samples[state] = [];
          if (samples[state].length < 3) samples[state].push(team.display_name);
          fixed++;
        } else {
          try {
            await client.query(
              'UPDATE teams_v2 SET state = $1 WHERE id = $2',
              [state, team.id]
            );
            stateUpdates[state] = (stateUpdates[state] || 0) + 1;
            fixed++;
          } catch (err) {
            if (err.code === '23505') {
              skipped++;
            } else {
              throw err;
            }
          }
        }
      }
    }

    console.log(`\n${dryRun ? '🔍 Would update' : '✅ Updated'} ${fixed} of ${unknownTeams.length} teams (${skipped} skipped)`);

    // Sort by count descending
    const sorted = Object.entries(stateUpdates).sort((a, b) => b[1] - a[1]);
    console.log('\nState distribution:');
    for (const [state, count] of sorted) {
      const sampleStr = samples[state] ? ` — e.g. "${samples[state][0]}"` : '';
      console.log(`  ${state}: ${count}${sampleStr}`);
    }
    console.log(`\nRemaining unknown: ${unknownTeams.length - fixed - skipped}`);

  } finally {
    client.release();
  }
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
