/* Integration audit against a specified versioned run; does not start an HTTP server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const run = path.resolve(process.argv[2]);
process.env.DATABASE_PATH = path.join(run, 'csrs_pipeline_b_repaired.db');
process.env.ARTIFACT_ROOT = path.join(run, 'Research_Figures');
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH, { readonly: true });
const { AnalyticsService } = require('./dist/services/analyticsService');
const { CustomerService } = require('./dist/services/customerService');
const { DashboardService } = require('./dist/services/dashboardService');
const { SegmentService } = require('./dist/services/segmentService');
const { MigrationService } = require('./dist/services/migrationService');
const { ClusterRegistryService } = require('./dist/services/clusterRegistryService');
const { ArtifactService } = require('./dist/services/artifactService');
const { profileOrder } = require('./dist/utils/clusterProfiles');
const sum = (rows, key) => rows.reduce((total,row) => total + Number(row[key] || 0),0);
const close = (left,right) => assert.ok(Math.abs(left-right)<1e-6, `${left} != ${right}`);

(async () => {
  const a = new AnalyticsService(), c = new CustomerService(), r = new ClusterRegistryService();
  const evaluation = a.getModelEvaluationDetailed();
  const pca = a.getPcaAnalytics();
  const overview = await new DashboardService().getOverview();
  const segments = await new SegmentService().getSegments();
  const migration = await new MigrationService().getMigration();
  const quality = db.prepare('SELECT * FROM Current_Model_Quality ORDER BY cycleNumber').all();
  const rawRows = db.prepare('SELECT COUNT(*) AS n FROM Data_Preprocessing_Results').get().n;
  assert.equal(pca.points.length, rawRows);
  assert.equal(pca.points.filter(row => row.currentModelFit).length,rawRows);
  assert.equal(pca.centroids.length,sum(quality,'SelectedK'));
  assert.equal(evaluation.semanticConsistency.available,true);
  assert.equal(evaluation.semanticConsistency.totals.renamedLinks,11);
  assert.equal(evaluation.populationQualityDiagnostics.available,true);
  assert.equal(evaluation.populationQualityDiagnostics.latest.length,4);
  close(evaluation.baseline.Inertia,56.57129846352495);
  assert.equal(migration.cycleMigration.find(row=>row.CycleID==='Cycle_0').AverageMembership,null);
  assert.ok(segments.profiles.filter(row=>row.CycleID==='Cycle_0').every(row=>row.averageMembership==null));
  const cycles = [];
  for (const saved of quality) {
    const cycle = saved.CycleID;
    const actual = evaluation.cycles.find(row=>row.CycleID===cycle);
    assert.ok(actual,cycle);
    assert.equal(actual.SelectedK,saved.SelectedK);
    close(actual.SilhouetteScore,saved.SilhouetteScore);
    close(actual.DaviesBouldinScore,saved.DaviesBouldinScore);
    close(actual.CalinskiHarabaszScore,saved.CalinskiHarabaszScore);
    if(cycle!=='Cycle_0') {
      close(actual.XieBeniIndex,saved.XieBeniIndex);
      close(actual.AverageMembership,saved.AverageMembership);
    } else assert.equal(actual.AverageMembership,null);
    const registry = r.getRegistry(cycle);
    assert.equal(registry.length,saved.SelectedK);
    assert.equal(new Set(registry.map(row=>row.displayLabel)).size,saved.SelectedK);
    assert.equal(sum(registry,'hardWinnerCustomers'),saved.ModelFitCustomers);
    assert.ok(registry.every(row=>profileOrder.includes(row.businessProfile) && typeof row.description==='string'));
    close(sum(registry,'hardWithinSumSquares'),saved.Inertia);
    close(registry.reduce((total,row)=>total+row.meanSilhouette*row.hardWinnerCustomers,0)/saved.ModelFitCustomers,saved.SilhouetteScore);
    if(cycle!=='Cycle_0') {
      close(sum(registry,'fuzzyObjectiveContribution'),saved.FuzzyObjective);
      close(registry.reduce((total,row)=>total+row.meanMaximumMembership*row.hardWinnerCustomers,0)/saved.ModelFitCustomers,saved.AverageMembership);
    }
    if(cycle==='Cycle_9') assert.deepEqual(new Set(registry.map(row=>row.businessProfile)),new Set(profileOrder));
    const points = pca.points.filter(row=>row.CycleID===cycle);
    assert.equal(points.length,saved.ModelFitCustomers);
    const customers = c.getCustomers({cycle,page:1,pageSize:200});
    assert.equal(customers.meta.total,saved.ModelFitCustomers);
    assert.ok(customers.data.every(row=>row.currentModelFit&&row.lastFittedCycle===cycle));
    const analytics = a.getCustomerAnalytics(cycle);
    assert.equal(sum(analytics.riskByCluster,'customers'),saved.ModelFitCustomers);
    assert.equal(analytics.riskByCluster.length,saved.SelectedK);
    const expectedWarnings=db.prepare("SELECT COUNT(*) AS n FROM Data_Preprocessing_Results WHERE CycleID=? AND Risk_Status IN ('At risk','Slipping')").get(cycle).n;
    assert.equal(sum(analytics.riskByCluster,'atRiskCustomers'),expectedWarnings);
    cycles.push({cycle,customers:customers.meta.total,fittedK:registry.length,warningCustomers:expectedWarnings});
  }
  const all=c.getCustomers({cycle:'All',pageSize:200});
  assert.equal(all.meta.total,rawRows);
  const seen=new Set();
  for(let page=1;page<=all.meta.totalPages;page++) {
    for(const row of c.getCustomers({cycle:'All',pageSize:200,page,sortBy:'CustomerID',sortOrder:'asc'}).data) {
      const key=`${row.CycleID}:${row.CustomerID}`;
      assert.ok(!seen.has(key),`Duplicate paginated observation ${key}`);seen.add(key);
    }
  }
  assert.equal(seen.size,rawRows);
  for(const risk of ['At risk','Slipping','Lost']) {
    const customers=c.getCustomers({cycle:'Cycle_9',risk,pageSize:200});
    const expected=db.prepare('SELECT COUNT(*) AS n FROM Dynamic_Loop_Results WHERE CycleID=? AND Risk_Status=?').get('Cycle_9',risk).n;
    assert.equal(customers.meta.total,expected);
    assert.ok(customers.data.every(row=>row.Risk_Status===risk));
  }
  const expectedSales=db.prepare('SELECT SUM(Current_Period_Revenue) AS n FROM Data_Preprocessing_Results').get().n;
  const expectedOrders=db.prepare('SELECT SUM(Current_Period_Orders) AS n FROM Data_Preprocessing_Results').get().n;
  close(overview.totalRevenue,expectedSales);close(overview.orders,expectedOrders);
  assert.equal(overview.totalCustomers,4297);assert.equal(overview.fittedClusterCount,9);
  const products=a.getProductAnalytics(), geography=a.getGeographicAnalytics(), firmographic=a.getFirmographicAnalytics();
  const marketSelection=a.getCountryMarketKSelection();
  assert.equal(marketSelection.available,true);
  assert.equal(marketSelection.selectedK,4);
  assert.equal(geography.clusterCount,marketSelection.selectedK);
  assert.equal(geography.segmentNames.length,marketSelection.selectedK);
  assert.deepEqual(marketSelection.rows.map(row=>row.k),[2,3,4,5,6,7,8,9,10]);
  assert.ok(marketSelection.rows.every(row=>Number.isFinite(row.inertia)&&Number.isFinite(row.silhouette)));
  assert.equal(marketSelection.features.length,6);
  assert.equal(evaluation.geographicMethod.features.length,6);
  assert.equal(evaluation.geographicMethod.groups.length,marketSelection.selectedK);
  assert.ok(marketSelection.figureUrls.wcss&&marketSelection.figureUrls.silhouette);
  assert.equal(geography.kSelection.selectedK,4);
  assert.equal(firmographic.summary.customers,4297);
  assert.equal(firmographic.summary.behaviouralSegments,9);
  close(sum(products.portfolio,'revenue'),db.prepare('SELECT SUM(Revenue) AS n FROM Dynamic_Customer_Summary').get().n);
  assert.equal(sum(firmographic.combinations,'customers'),4297);
  const profile=c.getCustomerProfile('12347');assert.ok(profile&&profile.history.length>0);
  assert.ok(new ArtifactService().getAll().some(row=>row.relativePath==='Baseline/cycle0_elbow_wcss.png'));
  const report={passed:true,scope:'Direct application services and read-only SQLite; no HTTP/browser access',
    customerCycleRows:rawRows,paginatedUniqueRows:seen.size,currentFittedPositions:pca.centroids.length,
    latestFittedK:overview.fittedClusterCount,positivePeriodRevenue:overview.totalRevenue,periodOrders:overview.orders,
    semanticAuditAvailable:true,populationQualityAvailable:true,cycle0Inertia:evaluation.baseline.Inertia,
    geographicK:geography.clusterCount,marketIntegrationCustomers:firmographic.summary.customers,
    countryMarketSelection:{selectedK:marketSelection.selectedK,candidates:marketSelection.rows.length,features:marketSelection.features.length},
    approvedNamesVerified:true,perClusterQualityVerified:true,
    loadedAdditionalServices:{segments:Object.keys(segments),migration:Object.keys(migration)},cycles};
  fs.writeFileSync(path.join(run,'service_audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));db.close();
})().catch(error=>{console.error(error);db.close();process.exitCode=1;});
