# Sanitized provider contract fixtures

These files are small, synthetic fixtures that reproduce only the public transport
shape required by the parser tests. They are not archived copies of provider
content and contain no credentials.

| Fixture | Format source | Retrieval/reference date |
| --- | --- | --- |
| `fed-rss.xml` | `https://www.federalreserve.gov/feeds/feeds.htm` | 2026-08-02 |
| `ecb-atom.xml` | `https://www.ecb.europa.eu/home/html/rss.en.html` | 2026-08-02 |
| `sec-rss.xml` | `https://www.sec.gov/about/rss-feeds` | 2026-08-02 |
| `bls-calendar.ics` | `https://www.bls.gov/schedule/news_release/bls.ics` | 2026-08-02 |

Names, identifiers and timestamps are deliberately fixture values. Tests must not
make live provider requests.
