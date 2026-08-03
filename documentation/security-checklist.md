# Security Checklist

- [x] Separate Dinner Swipe PostgreSQL service and credentials
- [x] Email verification and password reset tokens are stored hashed and expire
- [x] SMTP credentials are environment-only, not repository files
- [x] No secrets committed
- [x] `.env.example` uses placeholders
- [x] JWT secret validation for production
- [x] SSRF protections for URL ingestion
- [x] Upload size, row count, extension, and XLSX signature checks
- [x] Formula-injection escaping for error CSV export
- [x] User-scoped auth dependencies on protected endpoints
- [x] Reverse-proxy config is documentation only
- [ ] Production token storage strategy for web
- [ ] Rate limits on public endpoints
- [ ] Object storage and malware scanning for copied recipe images
- [ ] Full native security review before app-store release
