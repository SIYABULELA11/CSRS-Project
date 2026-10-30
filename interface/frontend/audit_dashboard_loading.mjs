// Exercise the actual frontend loader against HTTP, including duplicate mounts,
// bounded startup traffic, on-demand PCA cycles, and transient response recovery.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createServer} from 'vite';

const root=path.dirname(fileURLToPath(import.meta.url));
const target=process.argv[2] || 'http://localhost:4000';
process.env.VITE_API_URL=target;
const nativeFetch=globalThis.fetch;
const requests=[];
let active=0,peak=0;
const faults=new Map();
globalThis.fetch=async (input,options)=>{
  const url=String(input);active+=1;peak=Math.max(peak,active);
  const fault=faults.get(new URL(url).pathname);
  if(fault) {
    faults.delete(new URL(url).pathname);
    active-=1;
    return new Response(fault==='503'?'Service unavailable':'{"incomplete":', {status:fault==='503'?503:200,headers:{'Content-Type':'application/json'}});
  }
  try {
    const response=await nativeFetch(input,options);
    const bytes=await response.arrayBuffer();
    requests.push({url,status:response.status,bytes:bytes.byteLength});
    return new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
  } finally {active-=1;}
};
const vite=await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const service=await vite.ssrLoadModule('/src/services/dashboardService.js');
  const [data,duplicate]=await Promise.all([service.fetchDashboardBundle(),service.fetchDashboardBundle()]);
  assert.equal(data,duplicate,'Concurrent openings must share the same bundle request');
  assert.equal(requests.length,14);
  assert.ok(peak<=2,`Peak initial concurrency ${peak}`);
  assert.equal(data.pcaAnalytics.points.length,0,'Startup must not include full customer PCA history');
  assert.equal(data.overview.totalCustomers,4297);
  assert.deepEqual(data.modelEvaluation.cycles.map(row=>row.SelectedK),[5,5,5,5,5,6,6,7,8,9]);
  const initialBytes=requests.reduce((total,row)=>total+row.bytes,0);
  assert.ok(initialBytes<2_000_000,`Initial dashboard payload ${initialBytes}`);
  const require=createRequire(path.join(root,'../backend/package.json'));
  const Database=require('better-sqlite3');
  const db=new Database(path.resolve(root,'../../deployment/current/csrs_pipeline_b_repaired.db'),{readonly:true});
  const cycles=[];
  let pointTotal=0;
  for(let number=0;number<10;number+=1) {
    const cycle=`Cycle_${number}`;
    const result=await service.fetchPcaCycle(cycle);
    const expected=db.prepare('SELECT CustomerID,PC1,PC2,PC3 FROM Data_Preprocessing_Results WHERE CycleID=?').all(cycle);
    const points=new Map(result.points.map(row=>[row.CustomerID,row]));
    assert.equal(points.size,expected.length);
    for(const row of expected) {
      const actual=points.get(row.CustomerID);assert.equal(actual.CycleID,cycle);
      for(const axis of ['PC1','PC2','PC3']) assert.equal(actual[axis],row[axis]);
    }
    cycles.push({cycle,points:points.size});pointTotal+=points.size;
  }
  assert.equal(pointTotal,30280);db.close();
  service.clearDashboardCache();
  faults.set('/api/overview','503');faults.set('/api/model/evaluation/detailed','truncated');
  const recovered=await service.fetchDashboardBundle();
  assert.equal(recovered.overview.totalCustomers,4297);
  assert.equal(faults.size,0,'Both simulated failures must have been retried');
  assert.ok(requests.every(row=>row.status===200));
  const report={passed:true,target,initialRequestCount:14,peakInitialConcurrency:2,initialBytes,baselinePcaBytes:20_042_406,initialBundleContainsNoCustomerPoints:true,allCyclePcaPointsPreserved:pointTotal,cycles,duplicateMountDeduplicated:true,simulated503AndTruncatedJsonRecovered:true,scope:'Real frontend loader against HTTP; all PCA coordinates reconciled to read-only saved database; transient failures are explicitly simulated'};
  fs.writeFileSync(path.resolve(root,'../../tmp/dashboard_loading_audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {globalThis.fetch=nativeFetch;await vite.close();}
