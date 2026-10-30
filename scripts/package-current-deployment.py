"""Package a saved audited run for Node/Render without refitting or changing its database."""
from pathlib import Path
import argparse, gzip, hashlib, json, shutil, sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('--run-dir', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
run = args.run_dir.resolve()
output = root / 'deployment/current'
output.mkdir(parents=True, exist_ok=True)
database = run / 'csrs_pipeline_b_repaired.db'
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
before = sha(database)
with database.open('rb') as source, (output / 'csrs_pipeline_b_repaired.db.gz').open('wb') as destination:
    with gzip.GzipFile(filename='', mode='wb', fileobj=destination, compresslevel=6, mtime=0) as archive:
        shutil.copyfileobj(source, archive)
archive = output / 'csrs_pipeline_b_repaired.db.gz'
assert archive.stat().st_size < 90 * 1024 * 1024, 'Archive exceeds safe GitHub file size'
shutil.copytree(run / 'Research_Figures', output / 'Research_Figures', dirs_exist_ok=True)
files = [
    'evaluation_report.json', 'semantic_cluster_audit.json', 'population_quality_diagnostics.json',
    'independent_mdfcm_audit.json', 'centroid_update_audit.json', 'preprocessing_audit.json',
    'customer_risk_audit.json', 'population_scope_audit.json', 'synthetic_branch_verification.json',
    'naming_update_audit.json', 'per_cluster_quality_audit.json', 'cluster_count_display_audit.json',
    'evaluation_page_audit.json', 'pca_summary_card_update_audit.json',
    'current_model_quality.csv', 'current_cluster_profiles.csv', 'per_cluster_quality.csv',
    'per_cluster_centroids.csv', 'population_quality_diagnostics.csv',
    'cluster_identity_profile_history.csv', 'CLUSTER_IDENTITY_AND_MIGRATION.md', 'APPROVED_CLUSTER_NAMES.md',
]
for filename in files:
    if (run / filename).exists(): shutil.copy2(run / filename, output / filename)
for filename in ['cycle0_feature_scaler.pkl','cycle0_pca_model.pkl','cycle0_kmeans_model.pkl','cycle0_geographic_scaler.pkl','cycle0_geographic_kmeans.pkl']:
    shutil.copy2(run / filename, output / filename)
with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    cycles = [dict(zip(['cycle','customers','k','silhouette'], row)) for row in db.execute(
        'SELECT CycleID,ModelFitCustomers,SelectedK,SilhouetteScore FROM Current_Model_Quality ORDER BY cycleNumber')]
    assert [row['k'] for row in cycles] == [5,5,5,5,5,6,6,7,8,9]
    customers = db.execute('SELECT COUNT(DISTINCT CustomerID) FROM Data_Preprocessing_Results').fetchone()[0]
    observations = db.execute('SELECT COUNT(*) FROM Data_Preprocessing_Results').fetchone()[0]
manifest = {
    'sourceRun': run.name,
    'database': {'file':database.name,'archive':archive.name,'sha256':before,'uncompressedBytes':database.stat().st_size,'archiveBytes':archive.stat().st_size},
    'artifactRoot':'Research_Figures','customers':customers,'customerCycleRows':observations,'cycles':cycles,
    'files':[{'path':file.relative_to(output).as_posix(),'sha256':sha(file),'bytes':file.stat().st_size} for file in sorted(output.rglob('*')) if file.is_file() and file.name != 'manifest.json'],
}
(output / 'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
assert sha(database) == before
print(json.dumps({'sourceRun':run.name,'databaseSha256':before,'archiveMB':round(archive.stat().st_size/1024**2,2),'customers':customers,'customerCycleRows':observations,'files':len(manifest['files'])},indent=2))
