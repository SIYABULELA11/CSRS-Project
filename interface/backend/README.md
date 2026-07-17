# CSRS Backend

Express + TypeScript backend that reads CSRS results directly from SQLite (`csrs_pipeline_b.db`) and auto-discovers charts/reports from project files.

## Setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Run dev server:

```bash
npm run dev
```

4. Build and run production:

```bash
npm run build
npm start
```

## Key Endpoints

- `GET /api/dashboard/overview`
- `GET /api/model/evaluation`
- `GET /api/segments`
- `GET /api/segments/:segment`
- `GET /api/customers`
- `GET /api/customers/:id`
- `GET /api/migration`
- `GET /api/cycles`
- `GET /api/charts`
- `GET /api/images`
- `GET /api/images/:kind`
- `GET /api/html/:kind`
- `GET /api/reports`
- `GET /api/search?q=...`
- `GET /api/recommendations/:segment`
- `GET /api/files/:path(*)`
- `GET /docs`

## Notes

- Uses parameterized SQL to reduce SQL injection risk.
- Uses in-memory caching (`node-cache`) for hot endpoints.
- Serves discovered artifacts through backend routes so frontend never needs local file paths.

## Production Deployment (Required For GitHub Pages Frontend)

To make the deployed frontend work exactly like local, deploy this backend to a public host (Render/Railway/Fly/VM) and configure these environment variables:

- `PORT` - service port provided by your host.
- `DATABASE_PATH` - absolute path to `csrs_pipeline_b.db` on the server.
- `ARTIFACT_ROOT` - root folder for charts/reports on the server.
- `CORS_ORIGIN` - comma-separated allowlist including your frontend domain.

Example CORS setting for GitHub Pages:

```text
CORS_ORIGIN=https://<your-username>.github.io
```

Health check endpoint for deployment probes:

- `GET /health` -> `{ "status": "ok" }`
