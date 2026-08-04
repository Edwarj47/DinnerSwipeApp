# Security Checklist

- [x] Separate Dinner Swipe PostgreSQL service and credentials
- [x] Email verification and password reset tokens are stored hashed and expire
- [x] SMTP credentials are environment-only, not repository files
- [x] No secrets committed
- [x] `.env.example` uses placeholders
- [x] JWT secret validation for production
- [x] Native biometric unlock is device-local and layered on top of email/password auth
- [x] Refresh tokens are stored locally and used to renew expired access tokens
- [x] SSRF protections for URL ingestion
- [x] Upload size, row count, extension, and XLSX signature checks
- [x] Formula-injection escaping for error CSV export
- [x] User-scoped auth dependencies on protected endpoints
- [x] Reverse-proxy config is documentation only
- [ ] Production token storage strategy for web
- [ ] Refresh-token rotation and server-side revocation table before broad public release
- [ ] Rate limits on public endpoints
- [ ] Object storage and malware scanning for copied recipe images
- [ ] Full native security review before app-store release
