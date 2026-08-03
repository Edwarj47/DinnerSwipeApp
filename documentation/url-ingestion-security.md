# URL Ingestion Security

URL ingestion validates before initial fetch and before redirects.

Blocked:

- Non-HTTP protocols
- Missing hosts
- `localhost`
- Loopback, private, link-local, multicast, and reserved IPs
- `169.254.169.254`
- Unsupported content types
- Responses over `MAX_URL_RESPONSE_SIZE_BYTES`
- Redirect chains longer than four hops

The fetcher uses strict timeouts, a controlled user agent, no browser rendering by default, and no authentication-gated scraping. Browser-rendered extraction is left as a future adapter.

