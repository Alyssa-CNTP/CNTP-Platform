# research-engine/scraper/gather_v2.py
# Replaces gather.py entirely.
# Pulls from Google News (9 regions), Reddit (public API), classifies via Gemini,
# pushes every signal to the Next.js ingest route → Supabase.
# No local file writing. No fake platform labelling.
# Run: python gather_v2.py

import os
import time
import hashlib
import requests
import feedparser
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
from google import genai

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# ─── Config ───────────────────────────────────────────────────────────────────

GEMINI_API_KEY   = os.getenv("GEMINI_API_KEY")
PIPELINE_URL     = os.getenv("PIPELINE_URL", "http://localhost:3000/api/pipeline/ingest")
PIPELINE_SECRET  = os.getenv("PIPELINE_INGEST_SECRET")
INTERVAL_SECONDS = 2700  # 45 minutes

if not GEMINI_API_KEY:
    raise EnvironmentError("GEMINI_API_KEY missing from .env")
if not PIPELINE_SECRET:
    raise EnvironmentError("PIPELINE_INGEST_SECRET missing from .env")

client = genai.Client(api_key=GEMINI_API_KEY)

# ─── Seen hashes (deduplication) ──────────────────────────────────────────────
# Prevents the same article being pushed multiple times in one session.
# Resets when the script restarts — full deduplication handled by Supabase
# (you can add a unique index on source_url later).

seen_hashes: set[str] = set()

def make_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()

# ─── Keyword groups ───────────────────────────────────────────────────────────

KEYWORD_GROUPS = {
    "core_product": [
        "rooibos tea export",
        "rooibos manufacturing",
        "rooibos bulk supply",
        "red bush tea wholesale",
        "rosehip export",
        "honeybush tea export",
        "buchu tea export",
    ],
    "beverage_innovation": [
        "red espresso",
        "rooibos latte",
        "rooibos cold brew",
        "caffeine free espresso",
        "herbal espresso",
        "rooibos RTD beverage",
        "rooibos kombucha",
    ],
    "beauty_skincare": [
        "rooibos skincare ingredient",
        "aspalathin cosmetic",
        "rooibos extract beauty",
        "herbal tea skincare",
        "botanical extract cosmetics supplier",
        "K-beauty herbal ingredient",
    ],
    "clinical_wellness": [
        "rooibos health benefits study",
        "aspalathin clinical research",
        "rooibos anti-inflammatory",
        "herbal tea wellness supplement",
        "rooibos antioxidant research",
        "hospital herbal beverage supplier",
    ],
    "target_channels": [
        "bubble tea ingredient supplier",
        "specialty coffee distributor",
        "wellness beverage manufacturer",
        "private label herbal tea",
        "cafe beverage innovation",
        "hotel tea supplier",
    ],
    "oem_packaging": [
        "private label tea manufacturer",
        "herbal tea OEM",
        "tea co-packing",
        "ceylon tea packer",
        "tea blending facility",
        "biodegradable tea packaging",
    ],
    "competitor_signals": [
        "rooibos shortage",
        "rooibos supply disruption",
        "herbal tea recall",
        "rooibos quality complaint",
        "rooibos price drop",
        "competitor rooibos export",
    ],
    "sustainability": [
        "carbon neutral tea brand",
        "regenerative agriculture tea",
        "fair trade herbal tea",
        "B-Corp beverage brand",
        "ethical sourcing tea",
        "smallholder farmer tea",
    ],
    "agriculture": [
        "rooibos harvest forecast",
        "Cederberg farming",
        "rooibos farmer cooperative",
        "honeybush production",
        "African botanical supply",
        "herbal crop contract farming",
    ],
    "japan_expansion": [
        "tea processing equipment Japan",
        "Japanese tea machinery",
        "rooibos Japan market",
        "specialty tea Japan import",
        "tea co-manufacturing Japan",
        "Japanese beverage innovation",
    ],
    "south_africa_home": [
        "South African tea export",
        "Proudly South African beverage",
        "Woolworths tea supplier",
        "South African herbal tea retail",
        "Checkers tea private label",
        "Cape herbal tea",
    ],
    "matcha_adjacent": [
        "matcha alternative wholesale",
        "ceremonial matcha export",
        "caffeine free matcha alternative",
        "functional tea latte ingredient",
        "hojicha bulk supplier",
        "butterfly pea flower wholesale",
    ],
}

# ─── Regional RSS feeds ───────────────────────────────────────────────────────
# Each region gets its own language/country code.
# Gemini handles translation — we never skip non-English results.

REGIONS = [
    # Africa
    ("en-ZA", "ZA"),  ("en-NG", "NG"),  ("en-KE", "KE"),
    ("en-GH", "GH"),  ("en-TZ", "TZ"),  ("en-UG", "UG"),
    ("en-ZW", "ZW"),  ("en-ZM", "ZM"),  ("en-BW", "BW"),
    ("en-NA", "NA"),  ("en-MW", "MW"),  ("en-MZ", "MZ"),
    ("en-RW", "RW"),  ("en-ET", "ET"),  ("en-SN", "SN"),
    ("en-CI", "CI"),  ("en-CM", "CM"),  ("en-AO", "AO"),
    ("ar-EG", "EG"),  ("ar-MA", "MA"),  ("ar-DZ", "DZ"),
    ("ar-TN", "TN"),  ("ar-LY", "LY"),  ("ar-SD", "SD"),

    # Middle East
    ("ar-AE", "AE"),  ("ar-SA", "SA"),  ("ar-KW", "KW"),
    ("ar-QA", "QA"),  ("ar-BH", "BH"),  ("ar-OM", "OM"),
    ("ar-JO", "JO"),  ("ar-LB", "LB"),  ("he-IL", "IL"),
    ("tr-TR", "TR"),  ("fa-IR", "IR"),

    # Europe
    ("en-GB", "GB"),  ("de-DE", "DE"),  ("nl-NL", "NL"),
    ("fr-FR", "FR"),  ("it-IT", "IT"),  ("es-ES", "ES"),
    ("pl-PL", "PL"),  ("sv-SE", "SE"),  ("da-DK", "DK"),
    ("fi-FI", "FI"),  ("nb-NO", "NO"),  ("cs-CZ", "CZ"),
    ("de-AT", "AT"),  ("de-CH", "CH"),  ("pt-PT", "PT"),
    ("el-GR", "GR"),  ("hu-HU", "HU"),  ("ro-RO", "RO"),
    ("bg-BG", "BG"),  ("hr-HR", "HR"),  ("sk-SK", "SK"),
    ("sl-SI", "SI"),  ("et-EE", "EE"),  ("lv-LV", "LV"),
    ("lt-LT", "LT"),  ("uk-UA", "UA"),  ("ru-RU", "RU"),
    ("sr-RS", "RS"),  ("en-IE", "IE"),  ("fr-BE", "BE"),
    ("nl-BE", "BE"),  ("fr-LU", "LU"),  ("is-IS", "IS"),

    # Americas
    ("en-US", "US"),  ("en-CA", "CA"),  ("pt-BR", "BR"),
    ("es-MX", "MX"),  ("es-AR", "AR"),  ("es-CL", "CL"),
    ("es-CO", "CO"),  ("es-PE", "PE"),  ("es-VE", "VE"),
    ("es-EC", "EC"),  ("es-BO", "BO"),  ("es-PY", "PY"),
    ("es-UY", "UY"),  ("es-CR", "CR"),  ("es-GT", "GT"),
    ("es-DO", "DO"),  ("es-CU", "CU"),  ("en-JM", "JM"),
    ("en-TT", "TT"),

    # Asia Pacific
    ("ja-JP", "JP"),  ("ko-KR", "KR"),  ("zh-CN", "CN"),
    ("zh-TW", "TW"),  ("en-AU", "AU"),  ("en-NZ", "NZ"),
    ("en-IN", "IN"),  ("en-SG", "SG"),  ("ms-MY", "MY"),
    ("th-TH", "TH"),  ("id-ID", "ID"),  ("vi-VN", "VN"),
    ("fil-PH", "PH"), ("en-PK", "PK"),  ("en-BD", "BD"),
    ("en-LK", "LK"),  ("ne-NP", "NP"),  ("en-MM", "MM"),
    ("km-KH", "KH"),  ("lo-LA", "LA"),  ("zh-HK", "HK"),
    ("en-HK", "HK"),  ("mn-MN", "MN"),  ("kk-KZ", "KZ"),
    ("uz-UZ", "UZ"),

    # Central Asia / Caucasus
    ("ka-GE", "GE"),  ("hy-AM", "AM"),  ("az-AZ", "AZ"),

    # Pacific Islands
    ("en-FJ", "FJ"),  ("en-PG", "PG"),
]

# Which sections each keyword group feeds into
SECTION_MAP = {
    "core_product":       ["sales", "expansion"],
    "beverage_innovation":["sales", "expansion", "south_africa"],
    "beauty_skincare":    ["expansion"],
    "clinical_wellness":  ["expansion"],
    "target_channels":    ["sales", "expansion"],
    "oem_packaging":      ["sales", "expansion"],
    "competitor_signals": ["sales"],
    "sustainability":     ["sales", "expansion", "marketing"],
    "agriculture":        ["expansion", "south_africa"],
    "japan_expansion":    ["expansion"],
    "south_africa_home":  ["south_africa", "sales"],
    "matcha_adjacent":    ["expansion", "sales"],
}

# ─── Gemini classification ────────────────────────────────────────────────────

CLASSIFY_PROMPT = """You are a business intelligence analyst for a South African rooibos and herbal tea export company.

Analyse this content and respond ONLY with a JSON object — no markdown, no explanation, no backticks.

Content title: {title}
Content text: {content}
Source language: {language}

Return exactly this JSON structure:
{{
  "summary_en": "one sentence summary in English, specific and actionable, max 150 chars",
  "classification": "one of: opportunity, threat, competitor, regulation, relationship, neutral",
  "relevance_score": <integer 0-10>,
  "keyword_group": "the most relevant group from: core_product, beverage_innovation, beauty_skincare, clinical_wellness, target_channels, oem_packaging, competitor_signals, sustainability, agriculture, japan_expansion, south_africa_home, matcha_adjacent",
  "sections": ["array of relevant sections from: sales, expansion, marketing, south_africa, linkedin"]
}}

Scoring guide:
10 = direct actionable opportunity or serious threat requiring immediate attention
8-9 = high relevance, strong signal worth reviewing today
5-7 = moderate relevance, useful background intelligence
1-4 = low relevance, loosely related
0 = not relevant to the business at all"""

def classify_with_gemini(title: str, content: str, language: str) -> dict | None:
    try:
        prompt = CLASSIFY_PROMPT.format(
            title=title[:300],
            content=content[:500],
            language=language
        )
        response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
        )
        text = response.text.strip()

        # Strip markdown fences if Gemini adds them despite instructions
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

        import json
        result = json.loads(text)

        # Validate required fields
        required = ["summary_en", "classification", "relevance_score", "keyword_group", "sections"]
        if not all(k in result for k in required):
            return None

        return result

    except Exception as e:
        print(f"  [Gemini] Classification error: {e}")
        return None

# ─── Push to ingest route ─────────────────────────────────────────────────────

def push_signal(payload: dict) -> bool:
    try:
        response = requests.post(
            PIPELINE_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "x-pipeline-secret": PIPELINE_SECRET,
                # Generic user agent — does not identify this company
                "User-Agent": "Mozilla/5.0 (compatible; feed-reader/1.0)"
            },
            timeout=10
        )
        if response.status_code == 201:
            return True
        else:
            print(f"  [Ingest] Failed {response.status_code}: {response.text[:100]}")
            return False
    except Exception as e:
        print(f"  [Ingest] Request error: {e}")
        return False

# ─── Google News RSS ──────────────────────────────────────────────────────────

def fetch_google_news() -> int:
    pushed = 0
    total_feeds = len(KEYWORD_GROUPS) * len(REGIONS)
    print(f"  [RSS] Scanning {total_feeds} feeds across {len(REGIONS)} regions...")

    for group_name, keywords in KEYWORD_GROUPS.items():
        for hl, region in REGIONS:
            # Pick first keyword from group for this region
            # Rotate through keywords on each full cycle to maximise coverage
            query = "+OR+".join(keywords[:3]).replace(" ", "+")
            url = f"https://news.google.com/rss/search?q={query}&hl={hl}&gl={region}&ceid={region}:{hl.split('-')[0]}"

            try:
                feed = feedparser.parse(url)
                for entry in feed.entries[:5]:  # Max 5 per feed to stay within Gemini quota
                    title = entry.get("title", "").split(" - ")[0].strip()
                    link  = entry.get("link", "")

                    if not title or not link:
                        continue

                    # Deduplicate
                    h = make_hash(title + region)
                    if h in seen_hashes:
                        continue
                    seen_hashes.add(h)

                    # Detect language from region
                    lang = hl.split("-")[0]

                    # Get source domain
                    source_domain = entry.get("source", {}).get("title", "")
                    if not source_domain and link:
                        try:
                            from urllib.parse import urlparse
                            source_domain = urlparse(link).netloc.replace("www.", "")
                        except:
                            pass

                    # Classify with Gemini
                    content = entry.get("summary", title)
                    classification = classify_with_gemini(title, content, lang)

                    if not classification:
                        continue

                    # Skip irrelevant results
                    if classification["relevance_score"] == 0:
                        continue

                    payload = {
                        "source_type":     "google_news",
                        "source_url":      link,
                        "source_domain":   source_domain,
                        "language":        lang,
                        "title":           title,
                        "summary_en":      classification["summary_en"],
                        "classification":  classification["classification"],
                        "relevance_score": classification["relevance_score"],
                        "sections":        classification.get("sections", SECTION_MAP.get(group_name, ["sales"])),
                        "keyword_group":   classification.get("keyword_group", group_name),
                        "region":          region,
                        "media_url":       None,
                        "raw_content":     content[:1000] if content else None,
                    }

                    if push_signal(payload):
                        pushed += 1
                        score = classification["relevance_score"]
                        flag  = "🔴" if score >= 8 else "🟡" if score >= 5 else "⚪"
                        print(f"  {flag} [{region}] {title[:70]} (score:{score})")

                    # Small delay between Gemini calls to respect rate limits
                    time.sleep(0.5)

            except Exception as e:
                print(f"  [RSS] Error fetching {group_name}/{region}: {e}")
                continue

    return pushed

# ─── Reddit ───────────────────────────────────────────────────────────────────
# Uses Reddit's public JSON API — no credentials required.
# Only reads public posts. No authentication. No private data.

REDDIT_SEARCHES = [
    ("tea",            "rooibos"),
    ("Coffee",         "rooibos OR red espresso"),
    ("herbalism",      "rooibos OR honeybush"),
    ("wellness",       "rooibos OR herbal tea"),
    ("SkincareAddicts","rooibos OR herbal tea skin"),
    ("TeaExchange",    "rooibos"),
    ("café",           "rooibos OR caffeine free"),
    ("boba",           "herbal OR rooibos"),
]

def fetch_reddit() -> int:
    pushed = 0
    headers = {"User-Agent": "Mozilla/5.0 (compatible; feed-reader/1.0)"}
    print(f"  [Reddit] Scanning {len(REDDIT_SEARCHES)} subreddits...")

    for subreddit, query in REDDIT_SEARCHES:
        try:
            url = f"https://www.reddit.com/r/{subreddit}/search.json?q={query}&sort=new&limit=5&restrict_sr=1"
            response = requests.get(url, headers=headers, timeout=10)

            if response.status_code != 200:
                continue

            data = response.json()
            posts = data.get("data", {}).get("children", [])

            for post in posts:
                p = post.get("data", {})
                title   = p.get("title", "").strip()
                text    = p.get("selftext", "")[:500]
                link    = f"https://reddit.com{p.get('permalink', '')}"
                score   = p.get("score", 0)

                if not title:
                    continue

                # Only process posts with some engagement
                if score < 2:
                    continue

                h = make_hash(title + subreddit)
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)

                classification = classify_with_gemini(title, text or title, "en")
                if not classification or classification["relevance_score"] == 0:
                    continue

                payload = {
                    "source_type":     "reddit",
                    "source_url":      link,
                    "source_domain":   f"reddit.com/r/{subreddit}",
                    "language":        "en",
                    "title":           title,
                    "summary_en":      classification["summary_en"],
                    "classification":  classification["classification"],
                    "relevance_score": classification["relevance_score"],
                    "sections":        classification.get("sections", ["sales"]),
                    "keyword_group":   classification.get("keyword_group", "core_product"),
                    "region":          "GLOBAL",
                    "media_url":       None,
                    "raw_content":     text[:1000] if text else None,
                }

                if push_signal(payload):
                    pushed += 1
                    s = classification["relevance_score"]
                    flag = "🔴" if s >= 8 else "🟡" if s >= 5 else "⚪"
                    print(f"  {flag} [Reddit/r/{subreddit}] {title[:70]} (score:{s})")

                time.sleep(0.5)

        except Exception as e:
            print(f"  [Reddit] Error on r/{subreddit}: {e}")
            continue

    return pushed

# ─── Main loop ────────────────────────────────────────────────────────────────

def run():
    print("=" * 60)
    print("  Signal Gatherer v2 — Active")
    print(f"  Pipeline: {PIPELINE_URL}")
    print(f"  Interval: {INTERVAL_SECONDS // 60} minutes")
    print(f"  Regions:  {len(REGIONS)}")
    print(f"  Keywords: {sum(len(v) for v in KEYWORD_GROUPS.values())} across {len(KEYWORD_GROUPS)} groups")
    print("=" * 60)

    cycle = 0
    while True:
        cycle += 1
        now = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        print(f"\n[Cycle {cycle}] {now}")
        print("-" * 40)

        total = 0

        print("[1/2] Google News RSS")
        total += fetch_google_news()

        print("[2/2] Reddit")
        total += fetch_reddit()

        print("-" * 40)
        print(f"✅ Cycle {cycle} complete — {total} signals pushed")
        print(f"⏳ Next cycle in {INTERVAL_SECONDS // 60} minutes")

        time.sleep(INTERVAL_SECONDS)

if __name__ == "__main__":
    run()