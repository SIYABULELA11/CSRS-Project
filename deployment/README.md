# Current Render deployment

`current/manifest.json` identifies the exact audited numerical results served by the current dashboard. The current run is `named_20261025_214151` (numerical fitting source `run_20261025_195725`): 4,297 customers, 30,280 customer-cycle rows and K=5,5,5,5,5,6,6,7,8,9.

The SQLite snapshot is committed as a gzip archive because its uncompressed size exceeds GitHub's single-file limit. The Node startup wrapper streams it to a local database and verifies SHA-256 before opening the application. Render uses the bundled database and figures even if older dashboard environment settings still point at the previous model. Local `npm start` continues to honour `interface/backend/.env`.

The build and start commands remain:

```text
npm ci --include=dev --prefix interface/backend && npm run build --prefix interface/backend && npm ci --include=dev --prefix interface/frontend && npm run build --prefix interface/frontend
npm start --prefix interface/backend
```

`GET /health` reports the deployment commit, model run and database checksum on Render. The application is served at `/CSRS/`. No model is fitted during deployment.

To refresh the portable bundle from a future audited run:

```powershell
python scripts/package-current-deployment.py --run-dir 'model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151'
node interface/backend/scripts/prepare-deployment.cjs
```

The extracted `.db`, local secrets, logs, temporary reviews and older run directories remain untracked. Older results are retained locally; the pre-update GitHub main is preserved on the `older-version` branch. The `updated` branch records the version promoted to main.
