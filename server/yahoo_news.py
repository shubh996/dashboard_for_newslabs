import json
import os
import sys


def main():
    source_path = os.environ.get("YFINANCE_SOURCE_PATH", "/Users/shubh./Downloads/yfinance-main")
    if source_path and source_path not in sys.path:
        sys.path.insert(0, source_path)

    import yfinance as yf

    query = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    try:
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    except ValueError:
        limit = 12

    limit = max(1, min(limit, 50))
    search = yf.Search(
        query=query,
        max_results=limit,
        news_count=limit,
        include_research=True,
        raise_errors=False,
    )
    try:
        ticker_news = yf.Ticker(query).get_news(count=limit, tab="all")
    except Exception:
        ticker_news = []

    print(
        json.dumps(
            {
                "query": query,
                "quotes": search.quotes,
                "news": search.news,
                "ticker_news": ticker_news,
                "research": search.research,
                "response": search.response,
            },
            ensure_ascii=False,
            default=str,
        )
    )


if __name__ == "__main__":
    main()
