# Environment Assessment

Date: 2026-08-02
Host: `srv1360614`
Working directory: `/home/codexvps/Desktop/dinner-swipe`

## System

- OS: Ubuntu 24.04.4 LTS
- Public IPv4 observed: `187.77.15.246`
- Docker bridge/private addresses observed: `172.17.0.1`, `172.18.0.1`, `172.19.0.1`, `172.20.0.1`
- IPv6 observed: `2a02:4780:4:197c::1`
- Disk: `/dev/sda1`, 96 GB total, 46 GB used, 51 GB available

## Tooling

- Docker: 29.1.3
- Docker Compose: 2.40.3
- Node.js: 22.23.1
- npm: 11.17.0
- Python: 3.12.3
- Git: 2.43.0

## Existing Listeners To Avoid

- `127.0.0.1:5678`: existing n8n
- `127.0.0.1:2019`: Caddy admin
- `127.0.0.1:3010`: existing Umami
- `172.18.0.1:3001`: existing private admin app
- `127.0.0.1:3021`, `127.0.0.1:3080`, `127.0.0.1:3091`, `127.0.0.1:8001`, `127.0.0.1:8010`: existing app/service ports
- `*:80`, `*:443`: existing reverse proxy

Dinner Swipe defaults to localhost-only development ports:

- API: `127.0.0.1:8108`
- Mobile web dev: `127.0.0.1:19006`
- PostgreSQL container: internal only by default

## Existing Containers Observed

- `dcss-n8n`
- `dcss-postgres`
- `dcss-ollama`
- `dcss-n8n-runners`
- `dcss-python-worker`
- `dcss-chat-widget`
- `dcss-platforms`
- `dcss-umami`
- `dcss-umami-postgres`

No Dinner Swipe containers existed before this project was created.

## Existing n8n/Ollama Facts

- n8n data mount observed: `/var/lib/docker/volumes/docker_n8n_data/_data` -> `/home/node/.n8n`
- Ollama data mount observed: `/var/lib/docker/volumes/docker_ollama_data/_data` -> `/root/.ollama`
- Ollama models observed: `qwen3:4b-instruct-2507-q4_K_M`, `qwen3:1.7b-q4_K_M`, `llama3.2:3b`

No existing n8n, Ollama, PostgreSQL, reverse-proxy, or unrelated Docker configuration was modified.

## Backup/Export Locations Observed

- `/home/codexvps/Desktop/backups/n8n-workflows`
- `/home/codexvps/Desktop/backups/dcss-admin`
- `/home/codexvps/Desktop/backups/stockinsights`
- `/home/codexvps/Desktop/backups/volusia-outreach`
- `/home/codexvps/Desktop/backups/dcss-chat-widget`

## Security Notes

- This project uses isolated service names and named volumes.
- The Dinner Swipe database is configured as a separate PostgreSQL service and must not point at `dcss-postgres` or any existing n8n database.
- `.env.example` contains placeholders only.
- The proposed reverse-proxy route for `dinner.dcss.dev` is documentation only; no active proxy files were changed.

