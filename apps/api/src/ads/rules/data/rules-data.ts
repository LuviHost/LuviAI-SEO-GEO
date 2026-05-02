// Auto-generated from claude-ads MIT repo (v1.5, 2026-04-13)
// Üretici: scripts/parse-rules.js

export const ALL_RULES_DATA = {
  "google": [
    {
      "id": "G42",
      "name": "Conversion actions defined",
      "severity": "critical",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "≥1 primary conversion action configured",
      "warning": "N/A",
      "fail": "No active conversion actions"
    },
    {
      "id": "G43",
      "name": "Enhanced conversions enabled",
      "severity": "critical",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "Enhanced conversions active AND verified for primary conversions (~10% uplift, free setup) **[Quick Win: 5 min]**",
      "warning": "Enabled but not verified (check verification status in settings)",
      "fail": "Not enabled",
      "fixTimeMinutes": 5
    },
    {
      "id": "G44",
      "name": "Server-side tracking",
      "severity": "high",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "Server-side GTM or Google Ads API conversion import active",
      "warning": "Planned but not deployed",
      "fail": "No server-side tracking"
    },
    {
      "id": "G45",
      "name": "Consent Mode v2",
      "severity": "critical",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "Advanced Consent Mode v2 implemented (enforcement began July 21, 2025 for EEA/UK; recommended globally for signal recovery). Requires 700+ ad clicks/day over 7 days per country/domain for behavioral modeling to activate. Recovers 15-25% of lost conversions",
      "warning": "Basic mode only (huge data loss. Upgrade to Advanced immediately)",
      "fail": "Not implemented"
    },
    {
      "id": "G46",
      "name": "Conversion window appropriate",
      "severity": "medium",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "Window matches sales cycle (7d ecom, 30-90d B2B, 30d lead gen)",
      "warning": "Default 30d without validation",
      "fail": "Window mismatched to sales cycle"
    },
    {
      "id": "G47",
      "name": "Micro vs macro separation",
      "severity": "high",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "Only macro conversions (Purchase, Lead) set as \"Primary\" for bidding",
      "warning": "Some micro events as Primary",
      "fail": "All events including micro (AddToCart, TimeOnSite) as Primary"
    },
    {
      "id": "G48",
      "name": "Attribution model",
      "severity": "medium",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "Data-driven attribution (DDA) selected",
      "warning": "Last Click (intentional, document reasoning)",
      "fail": "Rule-based model active (first click, linear, time decay, position-based were ALL auto-upgraded to DDA. Any remaining rule-based is a legacy misconfiguration)"
    },
    {
      "id": "G49",
      "name": "Conversion value assignment",
      "severity": "high",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "Dynamic values for ecom; value rules for lead gen",
      "warning": "Static values assigned",
      "fail": "No conversion values"
    },
    {
      "id": "G-CT1",
      "name": "No duplicate counting",
      "severity": "critical",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "GA4 + Google Ads not double-counting same conversion",
      "warning": "N/A",
      "fail": "Both GA4 import and native tag counting same action"
    },
    {
      "id": "G-CT2",
      "name": "GA4 linked and flowing",
      "severity": "high",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "GA4 property linked, data flowing correctly",
      "warning": "Linked but data discrepancies",
      "fail": "Not linked"
    },
    {
      "id": "G-CT3",
      "name": "Google Tag firing",
      "severity": "critical",
      "category": "conversion",
      "categoryWeight": 0.25,
      "pass": "gtag.js or GTM firing correctly on all pages",
      "warning": "Firing on most pages (>90%)",
      "fail": "Tag missing or broken on key pages"
    },
    {
      "id": "G13",
      "name": "Search term audit recency",
      "severity": "critical",
      "category": "waste",
      "categoryWeight": 0.2,
      "pass": "Search terms reviewed within last 14 days",
      "warning": "Reviewed within 30 days",
      "fail": "Not reviewed in >30 days"
    },
    {
      "id": "G14",
      "name": "Negative keyword lists exist",
      "severity": "critical",
      "category": "waste",
      "categoryWeight": 0.2,
      "pass": "≥3 theme-based lists (Competitor, Jobs, Free, Irrelevant)",
      "warning": "1-2 lists exist",
      "fail": "No negative keyword lists"
    },
    {
      "id": "G15",
      "name": "Account-level negatives applied",
      "severity": "high",
      "category": "waste",
      "categoryWeight": 0.2,
      "pass": "Negative lists applied at account or all-campaign level",
      "warning": "Applied to some campaigns only",
      "fail": "Not applied"
    },
    {
      "id": "G16",
      "name": "Wasted spend on irrelevant terms",
      "severity": "critical",
      "category": "waste",
      "categoryWeight": 0.2,
      "pass": "<5% of spend on irrelevant search terms (last 30d)",
      "warning": "5-15% on irrelevant terms",
      "fail": ">15% on irrelevant terms"
    },
    {
      "id": "G17",
      "name": "Broad match + smart bidding pairing",
      "severity": "critical",
      "category": "waste",
      "categoryWeight": 0.2,
      "pass": "No Broad Match keywords running on Manual CPC. Note: Google reports exact-to-broad upgrades in tCPA campaigns see 35% more conversions on average, but ONLY with solid conversion data, Smart Bidding, and aggressive negative keyword management",
      "warning": "N/A",
      "fail": "Broad Match + Manual CPC active (wastes budget without algorithmic bid control)"
    },
    {
      "id": "G18",
      "name": "Close variant pollution",
      "severity": "high",
      "category": "waste",
      "categoryWeight": 0.2,
      "pass": "Exact/Phrase match not triggering irrelevant close variants",
      "warning": "Minor close variant issues",
      "fail": "Significant irrelevant close variant spend"
    },
    {
      "id": "G19",
      "name": "Search term visibility",
      "severity": "medium",
      "category": "waste",
      "categoryWeight": 0.2,
      "pass": ">60% of search term spend is visible (not hidden)",
      "warning": "40-60% visible",
      "fail": "<40% visible"
    },
    {
      "id": "G-WS1",
      "name": "Zero-conversion keywords",
      "severity": "high",
      "category": "waste",
      "categoryWeight": 0.2,
      "pass": "No keywords with >100 clicks and 0 conversions",
      "warning": "1-3 such keywords",
      "fail": ">3 keywords with >100 clicks, 0 conversions"
    },
    {
      "id": "G01",
      "name": "Campaign naming convention",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "Consistent pattern (e.g., [Brand]_[Type]_[Geo]_[Target])",
      "warning": "Partially consistent",
      "fail": "No naming convention"
    },
    {
      "id": "G02",
      "name": "Ad group naming convention",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "Matches campaign naming pattern",
      "warning": "Partially consistent",
      "fail": "No naming convention"
    },
    {
      "id": "G03",
      "name": "Single theme ad groups",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "Each ad group targets 1 keyword theme (≤10 keywords)",
      "warning": "11-20 keywords with consistent theme",
      "fail": "Ad groups with 20+ unrelated keywords (theme drift)"
    },
    {
      "id": "G04",
      "name": "Campaign count per objective",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "≤5 campaigns per funnel stage/objective",
      "warning": "6-8 campaigns per objective",
      "fail": ">8 campaigns per objective (fragmented)"
    },
    {
      "id": "G05",
      "name": "Brand vs Non-Brand separation",
      "severity": "critical",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "Brand and non-brand in separate campaigns",
      "warning": "N/A",
      "fail": "Brand and non-brand mixed in same campaign"
    },
    {
      "id": "G06",
      "name": "PMax present for eligible accounts",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "PMax active for accounts with conversion history. Note: brand exclusions and campaign-level negative keywords are now available for ALL PMax advertisers (2025). Customer match lists are the strongest audience signal",
      "warning": "PMax tested but paused",
      "fail": "No PMax tested despite eligibility"
    },
    {
      "id": "G07",
      "name": "Search + PMax overlap",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "Brand exclusions configured in PMax when Search brand campaign exists",
      "warning": "Partial brand exclusions",
      "fail": "No brand exclusions in PMax alongside brand Search"
    },
    {
      "id": "G08",
      "name": "Budget allocation matches priority",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "Top-performing campaigns not budget-limited",
      "warning": "Minor budget constraints on top performers",
      "fail": "Top performers severely budget-limited"
    },
    {
      "id": "G09",
      "name": "Campaign daily budget vs spend",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "No campaigns hitting budget cap before 6PM",
      "warning": "1-2 campaigns hitting cap early",
      "fail": "Multiple campaigns capped before noon"
    },
    {
      "id": "G10",
      "name": "Ad schedule configured",
      "severity": "low",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "Ad schedule set if business has operating hours",
      "warning": "N/A",
      "fail": "No schedule despite clear business hours"
    },
    {
      "id": "G11",
      "name": "Geographic targeting accuracy",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "\"People in\" (not \"People in or interested in\") for local",
      "warning": "N/A",
      "fail": "\"People in or interested in\" for local business"
    },
    {
      "id": "G12",
      "name": "Network settings",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.15,
      "pass": "Search Partners enabled for additional reach; Display Network disabled for Search (unless intentional)",
      "warning": "Search Partners OFF (missing incremental reach)",
      "fail": "Display Network ON for Search campaign"
    },
    {
      "id": "G20",
      "name": "Average Quality Score",
      "severity": "high",
      "category": "keywords",
      "categoryWeight": 0.15,
      "pass": "Account-wide impression-weighted QS ≥7",
      "warning": "QS 5-6",
      "fail": "QS ≤4"
    },
    {
      "id": "G21",
      "name": "Critical QS keywords",
      "severity": "critical",
      "category": "keywords",
      "categoryWeight": 0.15,
      "pass": "<10% of keywords with QS ≤3",
      "warning": "10-25% with QS ≤3",
      "fail": ">25% with QS ≤4"
    },
    {
      "id": "G22",
      "name": "Expected CTR component",
      "severity": "high",
      "category": "keywords",
      "categoryWeight": 0.15,
      "pass": "<20% of keywords with \"Below Average\" expected CTR",
      "warning": "20-35% Below Average",
      "fail": ">35% Below Average"
    },
    {
      "id": "G23",
      "name": "Ad relevance component",
      "severity": "high",
      "category": "keywords",
      "categoryWeight": 0.15,
      "pass": "<20% of keywords with \"Below Average\" ad relevance",
      "warning": "20-35% Below Average",
      "fail": ">35% Below Average"
    },
    {
      "id": "G24",
      "name": "Landing page experience",
      "severity": "high",
      "category": "keywords",
      "categoryWeight": 0.15,
      "pass": "<15% of keywords with \"Below Average\" landing page exp.",
      "warning": "15-30% Below Average",
      "fail": ">30% Below Average"
    },
    {
      "id": "G25",
      "name": "Top keyword QS",
      "severity": "medium",
      "category": "keywords",
      "categoryWeight": 0.15,
      "pass": "Top 20 spend keywords all have QS ≥7",
      "warning": "Some top keywords at QS 5-6",
      "fail": "Top keywords with QS ≤4"
    },
    {
      "id": "G-KW1",
      "name": "Zero-impression keywords",
      "severity": "medium",
      "category": "keywords",
      "categoryWeight": 0.15,
      "pass": "No keywords with 0 impressions in last 30 days",
      "warning": "<10% zero-impression",
      "fail": ">10% of keywords with 0 impressions"
    },
    {
      "id": "G-KW2",
      "name": "Keyword-to-ad relevance",
      "severity": "high",
      "category": "keywords",
      "categoryWeight": 0.15,
      "pass": "Headlines contain primary keyword variants",
      "warning": "Partial keyword inclusion",
      "fail": "No keyword variants in ad headlines"
    },
    {
      "id": "G26",
      "name": "RSA per ad group",
      "severity": "high",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "≥1 RSA per ad group (≥2 recommended)",
      "warning": "1 RSA per ad group",
      "fail": "Ad groups without any RSA"
    },
    {
      "id": "G27",
      "name": "RSA headline count",
      "severity": "high",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "≥8 unique headlines per RSA (ideal: 12-15)",
      "warning": "3-7 headlines",
      "fail": "<3 headlines"
    },
    {
      "id": "G28",
      "name": "RSA description count",
      "severity": "medium",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "≥3 descriptions per RSA (ideal: 4)",
      "warning": "2 descriptions",
      "fail": "<2 descriptions"
    },
    {
      "id": "G29",
      "name": "RSA Ad Strength",
      "severity": "high",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "All RSAs \"Good\" or \"Excellent\"",
      "warning": "Some \"Average\"",
      "fail": "Any RSA with \"Poor\" Ad Strength"
    },
    {
      "id": "G30",
      "name": "RSA pinning strategy",
      "severity": "medium",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "Strategic pinning (1-2 positions, 2-3 variants each)",
      "warning": "Over-pinned (all positions)",
      "fail": "N/A"
    },
    {
      "id": "G31",
      "name": "PMax asset group density",
      "severity": "critical",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "≥20 images, ≥5 logos, ≥5 native videos per group (maximum density). PMax needs 30-50+ conversions/month minimum to optimize effectively. Flag auto-generated video from images as WARNING (typically poor quality. Upload native video)",
      "warning": "5-19 images, 1-4 logos, or 1-4 videos; OR <30 conv/month (insufficient data for PMax)",
      "fail": "<5 images OR 0 logos OR 0 video"
    },
    {
      "id": "G32",
      "name": "PMax video assets present",
      "severity": "high",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "Native video in all formats (16:9, 1:1, 9:16)",
      "warning": "1-2 formats only",
      "fail": "No native video (auto-generated only)"
    },
    {
      "id": "G33",
      "name": "PMax asset group count",
      "severity": "medium",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "≥2 asset groups per PMax (intent-segmented)",
      "warning": "1 asset group",
      "fail": "N/A"
    },
    {
      "id": "G34",
      "name": "PMax final URL expansion",
      "severity": "high",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "Configured intentionally (ON for discovery, OFF for control)",
      "warning": "N/A",
      "fail": "Default ON without review"
    },
    {
      "id": "G35",
      "name": "Ad copy relevance to keywords",
      "severity": "high",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "Headlines contain primary keyword variants",
      "warning": "Partial keyword inclusion",
      "fail": "No keyword relevance in headlines"
    },
    {
      "id": "G-AD1",
      "name": "Ad freshness",
      "severity": "medium",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "New ad copy tested within last 90 days",
      "warning": "N/A",
      "fail": "No new ads in >90 days"
    },
    {
      "id": "G-AD2",
      "name": "CTR vs industry benchmark",
      "severity": "high",
      "category": "ads",
      "categoryWeight": 0.15,
      "pass": "CTR ≥ industry average",
      "warning": "CTR 50-100% of industry average",
      "fail": "CTR <50% of industry average"
    },
    {
      "id": "G50",
      "name": "Sitelink extensions",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "≥4 sitelinks per campaign",
      "warning": "1-3 sitelinks",
      "fail": "No sitelinks"
    },
    {
      "id": "G51",
      "name": "Callout extensions",
      "severity": "medium",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "≥4 callouts per campaign",
      "warning": "1-3 callouts",
      "fail": "No callouts"
    },
    {
      "id": "G52",
      "name": "Structured snippets",
      "severity": "medium",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "≥1 structured snippet set",
      "warning": "N/A",
      "fail": "No structured snippets"
    },
    {
      "id": "G53",
      "name": "Image extensions",
      "severity": "medium",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Image extensions active for search campaigns",
      "warning": "N/A",
      "fail": "No image extensions"
    },
    {
      "id": "G54",
      "name": "Call extensions (if applicable)",
      "severity": "medium",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Call extensions with call tracking for phone-based businesses",
      "warning": "Call extension without tracking",
      "fail": "No call extension for phone-based business"
    },
    {
      "id": "G55",
      "name": "Lead form extensions",
      "severity": "low",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Lead form tested for lead gen accounts",
      "warning": "N/A",
      "fail": "Not tested"
    },
    {
      "id": "G56",
      "name": "Audience segments applied",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Remarketing + in-market audiences in Observation mode",
      "warning": "Some audiences applied",
      "fail": "No audience signals"
    },
    {
      "id": "G57",
      "name": "Customer Match lists",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Customer Match list uploaded, refreshed <30 days",
      "warning": "List >30 days old",
      "fail": "No Customer Match lists"
    },
    {
      "id": "G58",
      "name": "Placement exclusions",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Account-level placement exclusions (games, apps, MFA sites)",
      "warning": "Campaign-level only",
      "fail": "No placement exclusions"
    },
    {
      "id": "G59",
      "name": "Landing page mobile speed",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Mobile LCP <2.5s (ideal <2.0s)",
      "warning": "LCP 2.5-4.0s",
      "fail": "LCP >4.0s"
    },
    {
      "id": "G60",
      "name": "Landing page relevance",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Landing page H1/title matches ad group theme",
      "warning": "Partial relevance",
      "fail": "No relevance to ad group"
    },
    {
      "id": "G61",
      "name": "Landing page schema markup",
      "severity": "medium",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Product/FAQ/Service schema present",
      "warning": "N/A",
      "fail": "No schema markup"
    },
    {
      "id": "G-PM1",
      "name": "Audience signals configured",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Custom audience signals per asset group",
      "warning": "Generic signals only",
      "fail": "No audience signals"
    },
    {
      "id": "G-PM2",
      "name": "PMax Ad Strength",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "\"Good\" or \"Excellent\"",
      "warning": "\"Average\"",
      "fail": "\"Poor\""
    },
    {
      "id": "G-PM3",
      "name": "Brand cannibalization",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "<15% of PMax conversions from brand terms",
      "warning": "15-30% from brand terms",
      "fail": ">30% from brand terms"
    },
    {
      "id": "G-PM4",
      "name": "Search themes",
      "severity": "medium",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Search themes configured (up to 50 per asset group)",
      "warning": "<5 search themes",
      "fail": "No search themes"
    },
    {
      "id": "G-PM5",
      "name": "Negative keywords",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Brand + irrelevant negatives applied (up to 10,000)",
      "warning": "Some negatives applied",
      "fail": "No negative keywords in PMax"
    },
    {
      "id": "G-PM6",
      "name": "PMax negative keywords active",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Campaign-level negative keywords configured (now available for ALL PMax advertisers). One client reported 15% immediate cost reduction after adding negatives **[Quick Win: 10 min]**",
      "warning": "Account-level negatives only, no campaign-level",
      "fail": "No negative keywords in PMax despite availability",
      "fixTimeMinutes": 10
    },
    {
      "id": "G-AI1",
      "name": "AI Max for Search evaluation",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "AI Max evaluated or active for accounts with sufficient conversion data (14% avg conversion lift). Strong negative keyword lists in place before enabling",
      "warning": "N/A",
      "fail": "AI Max not evaluated despite eligible account (>50 conv/month, established negative lists)"
    },
    {
      "id": "G-DG1",
      "name": "Demand Gen image assets",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Demand Gen campaigns include BOTH video AND image assets (20% more conversions at same CPA vs video-only). DoorDash case study: 15x higher CVR, 50% lower CPA",
      "warning": "Video assets only (missing image uplift)",
      "fail": "No Demand Gen campaigns despite eligible account"
    },
    {
      "id": "G-DG2",
      "name": "VAC migration status",
      "severity": "critical",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "All Video Action Campaigns migrated to Demand Gen (auto-upgraded April 2026)",
      "warning": "Migration in progress",
      "fail": "VAC campaigns still active (deprecated and will be force-migrated)"
    },
    {
      "id": "G-DG3",
      "name": "Demand Gen frequency capping loss",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "Former VAC campaigns with frequency caps: alternative measurement strategy in place (Video Frequency Groups alpha, or manual frequency monitoring)",
      "warning": "Frequency not monitored post-migration",
      "fail": "Former VAC campaigns relied on frequency caps now lost in DG with no replacement strategy"
    },
    {
      "id": "G-CTV1",
      "name": "CTV Floodlight tracking limitation",
      "severity": "high",
      "category": "settings",
      "categoryWeight": 0.1,
      "pass": "CTV campaigns use non-Floodlight measurement (Google Ads conversion tracking, GA4). Note: Floodlight conversion measurement DOES NOT work on CTV devices",
      "warning": "CTV campaigns active but measurement not verified",
      "fail": "CTV campaigns relying on Floodlight for conversion measurement (will not capture CTV conversions)"
    }
  ],
  "meta": [
    {
      "id": "M01",
      "name": "Meta Pixel installed",
      "severity": "critical",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "Pixel firing on all pages",
      "warning": "Firing on most pages (>90%)",
      "fail": "Pixel not firing"
    },
    {
      "id": "M02",
      "name": "Conversions API (CAPI) active",
      "severity": "critical",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "Server-side events sending alongside pixel. Note: Offline Conversions API permanently discontinued May 2025. All offline tracking now uses CAPI with action_source=\"physical_store\". Flag any accounts still configured for Offline Conversions API as FAIL",
      "warning": "CAPI planned but not deployed",
      "fail": "No CAPI (30-40% data loss post-iOS 14.5) OR still configured for discontinued Offline Conversions API"
    },
    {
      "id": "M03",
      "name": "Event deduplication",
      "severity": "critical",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "event_id matching between pixel and CAPI events; ≥90% dedup rate",
      "warning": "event_id present but <90% dedup rate",
      "fail": "Missing event_id (double-counting)"
    },
    {
      "id": "M04",
      "name": "Event Match Quality (EMQ)",
      "severity": "critical",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "Tiered EMQ targets: Purchase ≥8.5, AddToCart ≥6.5, PageView ≥5.5. Case study: EMQ 8.6→9.3 = CPA -18%, match rate +24%, ROAS +22%",
      "warning": "EMQ 6.0-7.9 (Purchase)",
      "fail": "EMQ <6.0 (Purchase)"
    },
    {
      "id": "M05",
      "name": "Domain verification",
      "severity": "high",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "Business domain verified in Business Manager",
      "warning": "N/A",
      "fail": "Domain not verified"
    },
    {
      "id": "M06",
      "name": "Aggregated Event Measurement (AEM)",
      "severity": "high",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "Top 8 events configured and prioritized correctly",
      "warning": "Events configured but not prioritized",
      "fail": "AEM not configured"
    },
    {
      "id": "M07",
      "name": "Standard events vs custom",
      "severity": "high",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "Using standard events (Purchase, AddToCart, Lead, etc.)",
      "warning": "Mix of standard and custom",
      "fail": "Custom events replacing standard events"
    },
    {
      "id": "M08",
      "name": "CAPI Gateway",
      "severity": "medium",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "CAPI Gateway deployed for simplified server-side",
      "warning": "Direct CAPI integration active",
      "fail": "N/A"
    },
    {
      "id": "M09",
      "name": "iOS attribution window",
      "severity": "high",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "7-day click / 1-day view configured",
      "warning": "1-day click only",
      "fail": "Attribution not configured"
    },
    {
      "id": "M10",
      "name": "Data freshness",
      "severity": "medium",
      "category": "pixel",
      "categoryWeight": 0.3,
      "pass": "Events firing in real-time (no >1hr lag in Events Manager)",
      "warning": "<4hr lag",
      "fail": ">4hr lag or intermittent firing"
    },
    {
      "id": "M25",
      "name": "Creative format diversity",
      "severity": "critical",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "≥3 formats active (static image, video, carousel)",
      "warning": "2 formats",
      "fail": "Only 1 format used"
    },
    {
      "id": "M26",
      "name": "Creative volume per ad set",
      "severity": "high",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "≥10 creatives for Advantage+ Sales campaigns, ≥5 for standard. Research: 25 diverse creatives = 17% more conversions at 16% lower cost",
      "warning": "3-4 creatives",
      "fail": "<3 creatives per ad set"
    },
    {
      "id": "M27",
      "name": "Video aspect ratios",
      "severity": "high",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "9:16 vertical video present for Reels/Stories",
      "warning": "Only 1:1 or 4:5 video",
      "fail": "No video assets"
    },
    {
      "id": "M28",
      "name": "Creative fatigue detection",
      "severity": "critical",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "No creatives with CTR drop >20% over 14 days while active. Andromeda compressed lifespan to 2-4 weeks (was 6-8). Creative Similarity Score: ads >60% similar get retrieval suppression by Andromeda",
      "warning": "CTR drop 10-20%",
      "fail": "CTR drop >20% + frequency >3 (fatigue confirmed)"
    },
    {
      "id": "M29",
      "name": "Hook rate (video)",
      "severity": "high",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "Video ads: <50% skip rate in first 3 seconds",
      "warning": "50-70% skip rate",
      "fail": ">70% skip rate in first 3s"
    },
    {
      "id": "M30",
      "name": "Social proof utilization",
      "severity": "medium",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "Top organic posts boosted as partnership/Spark ads",
      "warning": "Some organic boosting",
      "fail": "No organic content leveraged"
    },
    {
      "id": "M31",
      "name": "UGC / social-native content",
      "severity": "high",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "≥30% of creative assets are UGC or social-native",
      "warning": "10-30% UGC content",
      "fail": "<10% UGC (all polished/corporate)"
    },
    {
      "id": "M32",
      "name": "Advantage+ Creative",
      "severity": "medium",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "Advantage+ enhancements enabled (test vs control)",
      "warning": "N/A",
      "fail": "Not tested"
    },
    {
      "id": "M-CR1",
      "name": "Creative freshness",
      "severity": "high",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "New creative tested within last 14-21 days (tightened from 30d due to Andromeda acceleration)",
      "warning": "New creative 21-45 days ago",
      "fail": "No new creative in >45 days"
    },
    {
      "id": "M-CR2",
      "name": "Frequency: Prospecting (ad set)",
      "severity": "high",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "Ad set frequency <3.0 in last 7 days",
      "warning": "Frequency 3.0-5.0",
      "fail": "Frequency >5.0 (audience exhausted)"
    },
    {
      "id": "M-CR3",
      "name": "Frequency: Retargeting",
      "severity": "medium",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "Ad set frequency <8.0 in last 7 days",
      "warning": "Frequency 8.0-12.0",
      "fail": "Frequency >12.0"
    },
    {
      "id": "M-CR4",
      "name": "CTR benchmark",
      "severity": "high",
      "category": "creative",
      "categoryWeight": 0.3,
      "pass": "CTR ≥1.0%",
      "warning": "CTR 0.5-1.0%",
      "fail": "CTR <0.5%"
    },
    {
      "id": "M11",
      "name": "Campaign count",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "1-3 campaigns total recommended. Jon Loomer: \"One campaign per goal. Rarely need multiple ad sets for targeting\"",
      "warning": "4-5 campaigns",
      "fail": ">5 campaigns (over-fragmented)"
    },
    {
      "id": "M12",
      "name": "CBO vs ABO appropriateness",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "CBO for >$500/day; ABO for testing <$100/day",
      "warning": "Mismatched but functional",
      "fail": "CBO on <$100/day OR ABO on >$500/day"
    },
    {
      "id": "M13",
      "name": "Learning phase status",
      "severity": "critical",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "<30% of ad sets in \"Learning Limited\"",
      "warning": "30-50% Learning Limited",
      "fail": ">50% ad sets \"Learning Limited\""
    },
    {
      "id": "M14",
      "name": "Learning phase resets",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "No unnecessary edits during learning phase",
      "warning": "1-2 minor resets",
      "fail": "Frequent resets from edits during learning"
    },
    {
      "id": "M15",
      "name": "Advantage+ Sales campaign",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Advantage+ Sales (renamed from ASC early 2025) active for e-commerce with catalog. Existing customer budget cap eliminated Feb 2025. Research: 22% higher ROAS, 11.7% CPA improvement",
      "warning": "Advantage+ Sales tested but paused",
      "fail": "Not tested despite eligible catalog"
    },
    {
      "id": "M16",
      "name": "Ad set consolidation",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "No overlapping ad sets targeting same audience",
      "warning": "Minor overlap (<20%)",
      "fail": "Significant audience overlap (>30%)"
    },
    {
      "id": "M17",
      "name": "Budget distribution",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "All ad sets getting ≥$10/day",
      "warning": "Some ad sets $5-$10/day",
      "fail": "Ad sets getting <$5/day"
    },
    {
      "id": "M18",
      "name": "Campaign objective alignment",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Objective matches actual business goal",
      "warning": "N/A",
      "fail": "Objective mismatched (e.g., Traffic for Sales)"
    },
    {
      "id": "M33",
      "name": "Advantage+ Placements",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Advantage+ Placements enabled (unless exclusion needed)",
      "warning": "Manual placements (justified)",
      "fail": "Manual placements limiting delivery without reason"
    },
    {
      "id": "M34",
      "name": "Placement performance review",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Breakdown reviewed monthly; underperformers excluded",
      "warning": "Reviewed quarterly",
      "fail": "Never reviewed"
    },
    {
      "id": "M35",
      "name": "Attribution setting",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Attribution windows verified post-Jan 2026 changes (7-day and 28-day view-through windows REMOVED January 2026). 7-day click / 1-day view configured where available",
      "warning": "1-day click only",
      "fail": "Attribution not configured or still expecting removed view-through windows"
    },
    {
      "id": "M36",
      "name": "Bid strategy appropriateness",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Cost Cap for margin protection; Lowest Cost for volume",
      "warning": "N/A",
      "fail": "Bid Cap set below historical CPA"
    },
    {
      "id": "M37",
      "name": "Frequency cap monitoring (campaign)",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Campaign-level prospecting frequency <4.0 (7-day)",
      "warning": "Frequency 4.0-6.0",
      "fail": "Frequency >6.0"
    },
    {
      "id": "M38",
      "name": "Breakdown reporting",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Age, gender, placement, platform reviewed monthly",
      "warning": "Reviewed quarterly",
      "fail": "Never reviewed"
    },
    {
      "id": "M39",
      "name": "UTM parameters",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "UTM parameters on all ad URLs for GA4 attribution",
      "warning": "UTMs on some ads",
      "fail": "No UTM parameters"
    },
    {
      "id": "M40",
      "name": "A/B testing active",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "At least 1 active A/B test (Experiments)",
      "warning": "Test planned",
      "fail": "No testing infrastructure"
    },
    {
      "id": "M-ST1",
      "name": "Budget adequacy",
      "severity": "high",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": "Daily budget ≥5× target CPA per ad set",
      "warning": "Budget 2-5× CPA",
      "fail": "Budget <2× target CPA"
    },
    {
      "id": "M-ST2",
      "name": "Budget utilization",
      "severity": "medium",
      "category": "structure",
      "categoryWeight": 0.2,
      "pass": ">80% of daily budget being utilized",
      "warning": "60-80% utilization",
      "fail": "<60% utilization"
    },
    {
      "id": "M19",
      "name": "Audience overlap",
      "severity": "high",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "<20% overlap between active ad sets",
      "warning": "20-40% overlap",
      "fail": ">40% overlap between ad sets"
    },
    {
      "id": "M20",
      "name": "Custom Audience freshness",
      "severity": "high",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Website Custom Audiences refreshed within 180 days",
      "warning": "180-365 days old",
      "fail": ">365 days old or not created"
    },
    {
      "id": "M21",
      "name": "Lookalike source quality",
      "severity": "medium",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Lookalike source ≥1,000 users from high-value events",
      "warning": "500-1,000 users",
      "fail": "<500 users or low-value source"
    },
    {
      "id": "M22",
      "name": "Advantage+ Audience testing",
      "severity": "medium",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Advantage+ Audience tested vs manual",
      "warning": "N/A",
      "fail": "Not tested"
    },
    {
      "id": "M23",
      "name": "Exclusion audiences",
      "severity": "high",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Purchasers/converters excluded from prospecting",
      "warning": "Partial exclusions",
      "fail": "No purchaser exclusions from prospecting"
    },
    {
      "id": "M24",
      "name": "First-party data utilization",
      "severity": "high",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Customer list uploaded for Custom Audience + Lookalike",
      "warning": "List uploaded but not refreshed",
      "fail": "No first-party data uploaded"
    },
    {
      "id": "M-AN1",
      "name": "Andromeda creative diversity",
      "severity": "critical",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Ads genuinely diverse across creative concepts, messaging motivators, visual styles. Creative Similarity Score <60% across ad set. Different motivators unlock new audiences 89% of the time",
      "warning": "Some diversity but similar visual templates or minor copy variations",
      "fail": "All ads are minor variations (Andromeda clusters similar ads with Entity IDs; 100 minor variations = no better than 10)"
    },
    {
      "id": "M-AT1",
      "name": "Attribution window post-Jan 2026",
      "severity": "high",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Attribution windows verified and aligned with business model after Jan 2026 removal of 7-day/28-day view-through options",
      "warning": "Using default settings without review",
      "fail": "Attribution settings not configured or still expecting removed windows"
    },
    {
      "id": "M-IA1",
      "name": "Incremental Attribution testing",
      "severity": "medium",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Meta Incremental Attribution (launched April 2025) evaluated or active for measuring real causal impact via AI-powered holdout testing",
      "warning": "N/A",
      "fail": "Not evaluated despite sufficient budget (>$5K/month)"
    },
    {
      "id": "M-TH1",
      "name": "Threads placement evaluation",
      "severity": "low",
      "category": "audience",
      "categoryWeight": 0.2,
      "pass": "Threads placement reviewed (GA Jan 2026, 400M+ MAU). Lower CPMs but only ~0.04% of ad spend in Q3 2025. Worth testing for incremental reach",
      "warning": "N/A",
      "fail": "Not evaluated"
    }
  ]
} as const;