// Read-only integration check: render the actual page from direct services, without HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.dirname(fileURLToPath(import.meta.url));
const run = path.resolve(process.argv[2]);
process.env.DATABASE_PATH = path.join(run, 'csrs_pipeline_b_repaired.db');
process.env.ARTIFACT_ROOT = path.join(run, 'Research_Figures');
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(process.env.DATABASE_PATH)).digest('hex');
const before = hash();
const require = createRequire(path.join(root, '../backend/package.json'));
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH, {readonly:true});
const { AnalyticsService } = require('../backend/dist/services/analyticsService');
const { ArtifactService } = require('../backend/dist/services/artifactService');
const service = new AnalyticsService();
const data = {modelEvaluation: service.getModelEvaluationDetailed(), geographicAnalytics: service.getGeographicAnalytics(), artifacts: new ArtifactService().getAll()};
const report = data.modelEvaluation.evaluationReport;
assert.equal(report.available, true);
assert.equal(report.sourceDatabaseSha256, before);
assert.equal(report.baseline.SelectedK, 5);
assert.ok(Math.abs(report.baseline.Inertia - 56.57129846352495) < 1e-6);
assert.equal(report.baseline.AverageMembership, null);
assert.equal(report.baseline.XieBeniIndex, null);
assert.deepEqual(report.dynamicCycles.map(row => row.cycleNumber), [1,2,3,4,5,6,7,8,9]);
for (const row of report.behaviouralCycles) {
  const saved = data.modelEvaluation.cycles.find(item => item.CycleID === row.CycleID);
  assert.equal(row.SelectedK, saved.SelectedK);
  const storedQuality = db.prepare('SELECT * FROM Current_Model_Quality WHERE CycleID=?').get(row.CycleID);
  for (const field of ['SilhouetteScore','DaviesBouldinScore','CalinskiHarabaszScore','Inertia','XieBeniIndex','AverageMembership']) {
    if (row[field] == null) assert.equal(storedQuality[field], null);
    else assert.ok(Math.abs(row[field] - storedQuality[field]) < 1e-6, `${row.CycleID}: ${field}`);
  }
}
assert.equal(report.geographic.fittedK, 3);
assert.equal(report.geographic.cycles.length, 10);
assert.equal(report.validation.allMarketAssignmentsMatchSavedCentres, true);
assert.equal(report.validation.maximumGeographicMetricResidual, 0);
for (const relativePath of Object.values(report.figures)) assert.ok(data.artifacts.some(item => item.relativePath === relativePath));
const vite = await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{
  name:'expose-evaluation-for-audit',enforce:'pre',
  transform(code,id) {if(id.replaceAll('\\','/').endsWith('/src/csrs_interface.jsx')) return `${code}\nexport { EvaluationPage };`;}
}]});
try {
  const { EvaluationPage } = await vite.ssrLoadModule('/src/csrs_interface.jsx');
  const html = renderToStaticMarkup(React.createElement(EvaluationPage, {data}));
  for (const id of ['evaluation-baseline','evaluation-dynamic','evaluation-markets']) assert.ok(html.includes(`id="${id}"`));
  assert.equal((html.match(/class="evaluation-metric-plot"/g)||[]).length, 14);
  assert.ok(html.includes('56.571'));
  assert.ok(!html.includes('Metric unavailable'));
  assert.equal(hash(), before);
  const audit = {passed:true,scope:'Direct services and actual React component server rendering; no HTTP or browser review',sectionCount:3,interactivePanels:14,baselineK:5,baselineInertia:report.baseline.Inertia,dynamicCycles:9,geographicCycles:10,geographicK:3,metricsMatchStoredResults:true,geographicAssignmentsAndMetricsVerified:true,exportedFigures:Object.values(report.figures),databaseUnchanged:true,databaseSha256:before};
  fs.writeFileSync(path.join(run,'evaluation_page_audit.json'), JSON.stringify(audit,null,2));
  console.log(JSON.stringify(audit,null,2));
} finally {await vite.close();db.close();}
