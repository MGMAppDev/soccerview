# App Store Connect Guide — SoccerView

> **Version 1.0** | Created: February 7, 2026
>
> Shelf-ready submission guide. Separates one-time setup from the repeatable per-version checklist.

---

## Table of Contents

- [Part A: One-Time Setup (Static)](#part-a-one-time-setup-static)
- [Part B: Per-Version Release Checklist (Repeatable)](#part-b-per-version-release-checklist-repeatable)
- [Part C: Reference Tables](#part-c-reference-tables)
- [Part D: SoccerView Copy Bank](#part-d-soccerview-copy-bank)

---

## Part A: One-Time Setup (Static)

These fields are configured once during initial app creation. They rarely change between versions. Each section below corresponds to a page in App Store Connect, accessed via the left sidebar.

### A1. App Information

**Sidebar: General > App Information**

| Field | Value | Type | When to Update |
|-------|-------|------|----------------|
| **Name** | `SoccerView` | Text (30 char max) | Locked after first submission. Changing requires Apple approval. |
| **Subtitle** | `Team Stats & Power Ratings` | Text (30 char max) | Update if core value prop changes. Counted in ASO keyword index. |
| **Primary Category** | `Sports` | Dropdown | Only if app focus fundamentally changes. |
| **Secondary Category** | `Reference` | Dropdown | Optional. Change if a better fit emerges. |
| **Content Rights** | **Yes** + check "I have the necessary rights" | Radio + checkbox | Update if data sourcing changes (e.g., new licensed content). |
| **Age Rating** | See questionnaire answers below | Wizard | Update if app adds user-generated content, violence, gambling, etc. |
| **License Agreement** | Apple default EULA | Default/custom | Only change if adding custom legal terms. |

**Age Rating Questionnaire Answers (all produce 4+ rating):**

| Question | Answer |
|----------|--------|
| Parental Controls | No |
| Age Assurance | No |
| Unrestricted Web Access | No |
| User-Generated Content | No |
| Messaging/Chat | No |
| Advertising | No |
| Violence | None |
| Sexual Content & Nudity | None |
| Profanity & Crude Humor | None |
| Alcohol, Tobacco & Drugs | None |
| Horror & Fear | None |
| Simulated Gambling | None |
| Contests | No |
| Gambling (real money) | No |
| Loot Boxes | No |

**Result: 4+ (all regions)**

---

### A2. App Privacy

**Sidebar: App Store > Trust & Safety > App Privacy**

| Field | Value | When to Update |
|-------|-------|----------------|
| **Privacy Policy URL** | `https://mgmappdev.github.io/soccerview/docs/privacy-policy.html` | If URL changes or policy is moved to custom domain. |
| **User Privacy Choices URL** | (leave blank) | Add if you implement user data controls. |
| **Data Collection** | **"No, we do not collect data from this app"** | **MUST UPDATE** when adding: user accounts, analytics beyond Sentry, push notification tokens, favorites sync, or premium subscriptions. |

**When Data Collection Answer Changes to "Yes":**

If you add user accounts or premium subscriptions, you'll need to declare these data types:

| Feature | Data Types to Declare |
|---------|-----------------------|
| User accounts | Contact Info (email), Identifiers (user ID) |
| Push notifications | Identifiers (device ID) |
| Analytics (beyond Sentry) | Usage Data (product interaction), Diagnostics (crash data) |
| Subscriptions | Purchases (purchase history), Financial Info (payment info — handled by Apple) |

After selecting data types, for each you must declare: purpose, whether linked to identity, whether used for tracking.

**After completing, click "Publish" at top right of the App Privacy page.**

---

### A3. Pricing and Availability

**Sidebar: Monetization > Pricing and Availability**

| Field | Value | When to Update |
|-------|-------|----------------|
| **Base Country** | `United States` | Rarely changes. |
| **Price** | `Free` ($0.00) | **UPDATE at freemium launch** (Month 3-6). Note: the app itself stays free; IAP pricing is separate. |
| **Availability** | `All Countries or Regions` | Restrict only if legal/data issues in specific regions. |
| **Tax Category** | `App (Software)` — accept default | Only change if app category changes (e.g., becomes a news app). |
| **Pre-Order** | Disabled | Enable for major version launches if desired. |

---

### A4. App Review Contact Information

**Located on: Version page (1.0 Prepare for Submission), bottom section**

| Field | Value | When to Update |
|-------|-------|----------------|
| **Contact First Name** | `Mathieu` | If contact person changes. |
| **Contact Last Name** | `Miles` | If contact person changes. |
| **Contact Phone** | (your phone number) | If number changes. |
| **Contact Email** | (your email) | If email changes. |
| **Sign-in Required** | **Unchecked** (No) | Check only if app requires login. Provide demo credentials if checked. |

---

### A5. Export Compliance

**Appears as a popup when selecting a build, or set in Info.plist**

| Question | Answer | Rationale |
|----------|--------|-----------|
| Does your app use encryption? | **Yes** | App uses HTTPS for API calls. |
| Is it exempt from export compliance documentation? | **Yes** | Standard HTTPS (URLSession/fetch) is exempt. No custom/proprietary encryption. |

**Permanent fix:** Add `ITSAppUsesNonExemptEncryption = NO` to `Info.plist` to skip this popup on every future submission. This is safe because SoccerView only uses standard HTTPS.

---

### A6. URLs (set once, referenced on version page)

| URL Field | Value | Location |
|-----------|-------|----------|
| **Support URL** | `https://mgmappdev.github.io/soccerview/docs/support.html` | Version page |
| **Marketing URL** | (blank — optional) | Version page |
| **Privacy Policy URL** | `https://mgmappdev.github.io/soccerview/docs/privacy-policy.html` | App Privacy page |

**If you move to a custom domain (soccerview.app):**
1. Update Support URL on the version page
2. Update Privacy Policy URL on the App Privacy page
3. Update `docs/support.html` and `docs/privacy-policy.html` to redirect or mirror

---

## Part B: Per-Version Release Checklist (Repeatable)

Copy this entire section for each new version. Fill in the blanks and check boxes as you go.

---

### Version \_\_\_\_ Release Checklist — Date: \_\_\_\_

#### Step 1: Build

- [ ] Code changes complete and tested on device
- [ ] Run `eas build --platform ios`
- [ ] Build uploaded and processed in App Store Connect (check TestFlight tab)
- [ ] Build number: \_\_\_\_
- [ ] Test build in TestFlight — confirm no regressions

#### Step 2: Create New Version in App Store Connect

- [ ] Go to App Store Connect > Your App > sidebar
- [ ] If no new version exists: click **"+"** next to "iOS App" or use the version prompt
- [ ] Enter version number: \_\_\_\_

#### Step 3: Version Page Fields

**Sidebar: click the new version number (e.g., "1.1 Prepare for Submission")**

| Field | Action | Done |
|-------|--------|------|
| **What's New** | REQUIRED for updates. Write 2-4 bullet points. See templates in Part D. | [ ] |
| **Screenshots** | Update ONLY if UI changed significantly. Otherwise, previous screenshots carry over. | [ ] |
| **Promotional Text** | Update to highlight new features. Can change anytime without review. | [ ] |
| **Description** | Update if major new features added. Requires review. | [ ] |
| **Keywords** | Review ASO performance data. Adjust if needed. Requires review. | [ ] |
| **Support URL** | Verify still working. Usually unchanged. | [ ] |
| **Build** | Click **"Add Build" (+)** and select new build from list. | [ ] |
| **Copyright** | Update year if crossing January (e.g., `2026 SoccerView` to `2027 SoccerView`). | [ ] |

#### Step 4: App Review Information

| Field | Action | Done |
|-------|--------|------|
| **Reviewer Notes** | Update if new features need explanation. See templates in Part D. | [ ] |
| **Sign-in Required** | Check ONLY if this version adds login. Provide demo credentials. | [ ] |
| **Contact Info** | Verify phone/email still current. | [ ] |

#### Step 5: Version Release Option

- [ ] Select one:
  - **Manually release** — You control when it goes live after approval
  - **Automatically release** — Goes live immediately upon approval (default)
  - **Scheduled release** — Goes live on specific date/time

#### Step 6: Submit

- [ ] Review all fields one more time (scroll entire version page)
- [ ] Click **"Add for Review"** (top right)
- [ ] Select **"Create a new submission"** (or add to existing draft)
- [ ] Click **"Submit for Review"**
- [ ] Status: Waiting for Review

#### Step 7: Post-Submission

- [ ] Monitor status in App Store Connect (expect 24-48 hours)
- [ ] If rejected: read rejection reason, fix, resubmit
- [ ] If approved + auto-release: verify app is live on App Store
- [ ] If approved + manual release: click "Release This Version" when ready
- [ ] Update Promotional Text if needed (no review required, takes effect immediately)
- [ ] Monitor Sentry for new crash patterns from the update

---

## Part C: Reference Tables

### C1. Screenshot Specifications

| Device | Display Size | Pixels (Portrait) | Required? |
|--------|-------------|-------------------|-----------|
| iPhone 16 Pro Max | 6.9" | 1320 x 2868 | **YES** (primary) |
| iPhone 16 Plus / 15 Plus | 6.7" | 1290 x 2796 | Auto-scaled from 6.9" if not provided |
| iPhone 16 / 15 | 6.1" | 1179 x 2556 | Auto-scaled |
| iPhone SE | 4.7" | 750 x 1334 | Auto-scaled |
| iPad Pro 13" | 13" | 2064 x 2752 | Required if app runs on iPad |
| iPad 10.9" | 10.9" | 1640 x 2360 | Auto-scaled from 13" |

- Format: PNG or JPEG, no alpha channel
- Maximum: 10 screenshots per device size
- Minimum: 1 screenshot for required sizes
- Screenshots carry over between versions unless replaced

**Framing tool:** `python scripts/onetime/frameScreenshots.py --input-dir ./screenshots --output-dir ./screenshots/framed`

### C2. Character Limits

| Field | Limit | Localizable | Requires Review |
|-------|-------|-------------|-----------------|
| App Name | 30 characters | No | Yes (locked after first submit) |
| Subtitle | 30 characters | Yes | Yes |
| Promotional Text | 170 characters | Yes | **No** (update anytime) |
| Description | 4,000 characters | Yes | Yes |
| Keywords | 100 bytes (ASCII) | Yes | Yes |
| What's New | 4,000 characters | Yes | Yes |
| Reviewer Notes | 4,000 bytes | No | N/A (not public) |

**Important formatting rules:**
- **No emojis** in Description or What's New (Apple rejects with "invalid characters")
- **No em dashes** ( -- ) — use regular dashes ( - ) instead
- Plain text only — no HTML, no markdown, no rich formatting
- Bullet points: use the bullet character or dash-space

### C3. Common Apple Rejection Reasons (and How to Avoid)

| Rejection Reason | How to Avoid |
|------------------|-------------|
| **Guideline 2.1 — App Completeness** | No placeholder content, no "coming soon" features, no broken links |
| **Guideline 2.3 — Accurate Metadata** | Screenshots must show actual app UI. Description must match functionality. |
| **Guideline 4.0 — Design** | App must not be a repackaged website. Must use native UI elements. |
| **Guideline 4.2 — Minimum Functionality** | App must provide lasting value. Not just a wrapper around a single data feed. |
| **Guideline 5.1.1 — Data Collection and Storage** | Privacy policy must exist. App Privacy labels must be accurate. |
| **Guideline 5.1.2 — Data Use and Sharing** | Don't use data for purposes not disclosed to users. |
| **Bug — App crashes during review** | Test thoroughly on physical device. Check Sentry for crash-free rate. |
| **Missing demo account** | If app requires login, provide working demo credentials in Reviewer Notes. |

**SoccerView risk assessment: LOW.** No user accounts, no IAP, no UGC, no login required, displays publicly available sports data.

### C4. Export Compliance Quick Reference

| Scenario | Answer to "Uses Encryption?" | Answer to "Exempt?" |
|----------|------------------------------|---------------------|
| App only uses HTTPS (URLSession, fetch) | Yes | **Yes** (exempt) |
| App uses custom encryption algorithm | Yes | No (documentation required) |
| App has no network calls | No | N/A |

**Permanent skip:** Add to `app.json` or `Info.plist`:
```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
    }
  }
}
```

### C5. Version Numbering Convention

| Version | When to Use | Example |
|---------|-------------|---------|
| X.0 | Major release (new features, redesign) | 1.0, 2.0 |
| X.Y | Feature update | 1.1, 1.2 |
| X.Y.Z | Bug fix / hotfix | 1.1.1, 1.2.3 |

- **Version** = public-facing (shown on App Store)
- **Build number** = internal (increments with every upload). Current: 11.
- Build number must be unique per version. Increment for each upload.

### C6. App Store Connect Submission Status Flow

```
Prepare for Submission
    |
    v
Add for Review (creates draft submission)
    |
    v
Ready for Review (or "Submit for Review" if 2-step)
    |
    v
In Review (Apple is reviewing — typically 24-48 hours)
    |
    +---> Approved ---> Ready for Sale (if auto-release)
    |                   or
    |                   Ready for Release (if manual — you click "Release")
    |
    +---> Rejected ---> Fix issues ---> Resubmit
```

---

## Part D: SoccerView Copy Bank

Pre-written text blocks ready to copy-paste. Keep this section updated as the app evolves.

### D1. App Store Description (Current — Clean, No Emojis)

```
Your team. Your league. Everything in one place.

SoccerView brings together rankings, stats, standings, and match predictions for 100,000+ youth soccer teams across all 50 states - so you can stop bouncing between websites and see the full picture in one app.

DUAL RANKING SYSTEMS
- Official Rankings - Direct from GotSport national rankings (gold badge)
- Power Rating - Uses the same ELO system FIFA adopted for World Rankings (blue badge)
- See both side-by-side for the complete picture

SEARCH 100,000+ TEAMS
- Browse teams across all 50 states
- Filter by state, age group (U8-U19), and gender
- Complete team profiles with match history, W-L-D record, and ranking journey charts

DEEP TEAM ANALYTICS
- Season stats: wins, losses, draws, goals for/against
- Historical ranking journey with interactive charts
- ELO letter grades (A+ through D-) for instant strength assessment
- National and state rank tracking

LEAGUE STANDINGS
- Official points tables with W-D-L records
- Power rating view for ELO-based standings
- Filter by division, age group, gender
- Multiple leagues covered with daily updates

AI-POWERED MATCH PREDICTIONS
- Predict any matchup between ranked teams
- 6-factor algorithm: ELO, goal differential, win rate, championships, head-to-head, experience
- Confidence scoring and detailed factor breakdowns
- Share predictions with your soccer community

BEAUTIFUL DARK-THEMED DESIGN
- Modern, clean interface built for readability
- Smooth animations and haptic feedback
- Fast loading with skeleton placeholders
- Works great on all iPhone and iPad models

UPDATED DAILY
Rankings and match data refresh every night from official sources. Your team's latest results are always reflected.

BUILT BY A SOCCER PARENT
SoccerView was created by a youth soccer parent who wanted better tools to track his kid's team. Every feature exists because a real soccer parent needed it.

Questions? Visit our support page for help.
```

### D2. Promotional Text (Current)

```
Your team. Your league. The full picture. Rankings, stats, standings and AI predictions for 100,000+ youth soccer teams across all 50 states.
```

**Note:** Promotional Text can be updated anytime without app review. Use it to highlight seasonal events, new features, or milestones.

### D3. Keywords (Current)

```
youth soccer,club rankings,travel soccer,team stats,soccer scores,ECNL,MLS Next,GotSport,ELO rating
```

**ASO tips for future keyword updates:**
- No spaces after commas (wastes bytes)
- Don't repeat words already in App Name or Subtitle (Apple indexes those separately)
- Use singular forms (Apple matches both singular and plural)
- Check competitor keywords with ASO tools (AppFollow, Sensor Tower)
- 100-byte limit (not 100 characters — special characters use more bytes)

### D4. What's New Templates

**Bug Fix Release:**
```
- Bug fixes and performance improvements
- Improved app stability
```

**Feature Release (example):**
```
- New: Push notifications for ranking changes
- New: Share your team's ranking card on social media
- Improved search performance
- Bug fixes
```

**Data Expansion Release:**
```
- Added coverage for [X] new leagues
- Rankings now include [Y] teams across [Z] states
- Improved data accuracy for [specific area]
- Bug fixes and performance improvements
```

**Major Update (example):**
```
- Introducing Premium: unlock unlimited predictions, full ranking history, and more
- Redesigned team profile with new stats layout
- Added tournament bracket predictions
- Performance improvements across the app
```

### D5. Reviewer Notes Templates

**Standard (no special features):**
```
SoccerView displays publicly available youth soccer rankings and match data. No login required. The app fetches data from our servers and displays team rankings, match results, league standings, and AI-powered match predictions. All data is sourced from public sports organizations.
```

**When adding login/accounts:**
```
Demo account credentials:
Email: demo@soccerview.app
Password: [password]

This account has sample data pre-loaded for testing purposes.
```

**When adding IAP/subscriptions:**
```
To test in-app purchases, use a Sandbox Apple ID. Premium features include: [list features]. The subscription auto-renews monthly at $4.99 unless cancelled.
```

---

## Appendix: v1.0 Initial Setup Checklist (Historical Reference)

This was the complete checklist used for the initial v1.0 submission. Preserved here for reference — future versions only need Part B above.

| # | Page | Field | Value | Status |
|---|------|-------|-------|--------|
| 1 | App Information | Name | `SoccerView` | Done |
| 2 | App Information | Subtitle | `Team Stats & Power Ratings` | Done |
| 3 | App Information | Primary Category | `Sports` | Done |
| 4 | App Information | Secondary Category | `Reference` | Done |
| 5 | App Information | Content Rights | Yes + confirmed | Done |
| 6 | App Information | Age Rating | All None/No = 4+ | Done |
| 7 | App Privacy | Privacy Policy URL | GitHub Pages URL | Done |
| 8 | App Privacy | Data Collection | No data collected + Published | Done |
| 9 | Pricing & Availability | Price | Free | Done |
| 10 | Pricing & Availability | Availability | All Countries | Done |
| 11 | Version Page | Screenshots (6.9") | 10 uploaded | Done |
| 12 | Version Page | Promotional Text | See Part D | Done |
| 13 | Version Page | Description | See Part D (clean, no emojis) | Done |
| 14 | Version Page | Keywords | See Part D | Done |
| 15 | Version Page | Support URL | GitHub Pages URL | Done |
| 16 | Version Page | Build | Build 11 | Done |
| 17 | Version Page | Copyright | `2026 SoccerView` | Done |
| 18 | Version Page | Version Release | Automatically release | Done |
| 19 | Version Page | Contact Info | Mathieu Miles | Done |
| 20 | Version Page | Sign-in Required | No | Done |
| 21 | Version Page | Reviewer Notes | Standard template | Done |
| 22 | Export Compliance | Encryption | Yes, exempt (HTTPS only) | Done |
| 23 | Submit | Add for Review | Clicked | Done |
| 24 | Submit | Submit for Review | Clicked | Done |
