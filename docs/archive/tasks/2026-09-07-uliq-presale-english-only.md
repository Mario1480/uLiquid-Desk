# English-only public presale

Implemented locally at Mario's request on 2026-09-07.

- Public `/presale` routes and descendants use English regardless of language cookies or browser preferences.
- German and unprefixed URLs redirect to `/en/presale`, preserving the destination and query parameters.
- The public presale header no longer displays a language selector. Other areas retain their existing locale choices.
- Shared link generation keeps presale links English, including links from German pages.
- Translation catalogs remain aligned; no contract or purchase behavior changed.

Validation: all 10 locale-routing tests passed, including actual proxy redirect and English request-header assertions. Web typecheck passed. A local browser request to `/de/presale/terms` reached `/en/presale/terms` with English content and no language selector; the English terms route returned HTTP 200. The local server used hostname `localhost` to avoid the development origin mismatch observed with a `127.0.0.1` binding.

This is a language policy, not a conclusion about MiCA applicability. No deployment was performed.
