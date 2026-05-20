import feedparser
import json
import time
import os
from datetime import datetime

class GlobalPulseGatherer:
    def __init__(self):
        # Path to your Next.js public folder
        self.output_file = "../../public/live_feed.json"

    def get_news(self):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Refreshing Signal Stream...")
        # Keywords focusing on rooibos manufacturing, rosehip demand, and market news
        query = "rooibos+manufacturing+OR+rosehip+demand+OR+rooibos+tea+export"
        rss_url = f"https://news.google.com/rss/search?q={query}&hl=en-ZA&gl=ZA&ceid=ZA:en"
        
        feed = feedparser.parse(rss_url)
        results = []
        
        for e in feed.entries[:15]:
            platform = "news"
            title_lower = e.title.lower()
            
            # Smart categorization based on keywords
            if "tiktok" in title_lower or "viral" in title_lower: platform = "tiktok"
            elif "instagram" in title_lower or "ig" in title_lower or "reel" in title_lower: platform = "instagram"
            elif "twitter" in title_lower or " x " in title_lower or "post" in title_lower: platform = "twitter"

            results.append({
                "platform": platform,
                "title": e.title.split(" - ")[0],
                "content": e.source.get('title', 'Market Insight'),
                "timestamp": "LIVE",
                "link": e.link
            })
        return results

    def run(self):
        print("🚀 Signal Stream Gatherer Active...")
        while True:
            try:
                data = self.get_news()
                # Create public folder if it doesn't exist
                os.makedirs(os.path.dirname(self.output_file), exist_ok=True)
                
                with open(self.output_file, "w") as f:
                    json.dump(data, f)
                print(f"✅ Pulse Updated: {len(data)} signals pushed to UI.")
            except Exception as e:
                print(f"❌ Scraper Error: {e}")
            
            # Frequency: updates every 60 seconds
            time.sleep(60)

if __name__ == "__main__":
    GlobalPulseGatherer().run()