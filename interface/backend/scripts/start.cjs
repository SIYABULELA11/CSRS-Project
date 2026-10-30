// Render can retain older dashboard environment paths; always serve the verified current bundle there.
const { prepareDeployment } = require('./prepare-deployment.cjs');

(async () => {
  if (process.env.RENDER === 'true' || process.env.CSRS_USE_BUNDLED_DATA === '1') {
    const { manifest, database, artifactRoot } = await prepareDeployment();
    process.env.DATABASE_PATH = database;
    process.env.ARTIFACT_ROOT = artifactRoot;
    process.env.CSRS_MODEL_RUN = manifest.sourceRun;
    process.env.CSRS_DATABASE_SHA256 = manifest.database.sha256;
  }
  require('../dist/server.js');
})().catch(error => { console.error('Dashboard startup failed:', error.message); process.exitCode = 1; });
