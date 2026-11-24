# EPHENYX Pair Portal — Deployment notes

## Vercel

Vercel is configured as a **static portal preview**. The `/pair` and `/qr` serverless handlers intentionally return HTTP 503 because a serverless request cannot reliably keep the WhatsApp socket alive during linking. The old handler was disabled; it used phone-number-based temporary paths and lacked the security protections in the main Express pairing routes.

## Long-running host

Use the Express service for real pairing. The repository includes a Render Blueprint (`render.yaml`) that deploys a free service in Frankfurt and exposes `/health`. Free services can sleep and availability is not guaranteed; an always-on VPS/service is preferred for reliable linking.

Health response identifies the persistent-host mode and reports pairing enabled. Pairing sessions remain temporary, bounded and never send session credentials to WhatsApp.

## Security

- Never use the Vercel legacy handler or re-enable it.
- Do not expose `creds.json`, auth folders or credentials via download endpoints.
- Use the HTTPS public URL and keep rate-limit / resource controls enabled.
- Treat Vercel preview as UI-only; pairing must be served by a long-running process.


Status: this document is the current deployment gate. Do not deploy Vercel pairing handlers as live functionality; only the persistent Express host is enabled for pairing.

Verified CSP and no-store headers are enabled by the persistent Express host.
