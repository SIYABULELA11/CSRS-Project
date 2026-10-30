# Rebuilding the current model

Current run: `named_20261025_214151`. Current database: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151/csrs_pipeline_b_repaired.db`. Local URL: http://localhost:4000/CSRS/.

See [the current review](../../CURRENT_MODEL_REVIEW_2026-10-25.md) for full evidence and [the brief identity/migration report](../../CLUSTER_IDENTITY_AND_MIGRATION.md).

## Processing contract

Clean linked positive paid sales → complete customer snapshots → exact Recency and trailing-90-day F/M /3 → log1p → products RF/RM/FM → baseline MinMax → baseline three-component PCA → C0 static K-means at accepted elbow K5 → C1–C9 MDFCM → profile labels, individual warnings, geographic K3/customer-market integration and commercial summaries.

All observed customers are freshly fitted in dynamic cycles. Current observations replace old snapshots; historic mass is zero, with prior centres retained as initialization. Monthly purchase activity is separate from fit participation. Source transactions before each snapshot establish customer eligibility and latest purchase; lifetime spend does not replace the 90-day purchase measures. Current-period sales/orders are stored separately to avoid overlapping-window double counting.

Cycle 0 validation includes inertia (WCSS), silhouette, DB and CH. Inertia at K5 is 56.5713; the dashboard includes the elbow plot. Fuzzy objective/XB/mean maximum membership apply only to dynamic cycles. All numeric C0 values equal the previous accepted baseline.

The nine potential names include Valuable Customers at Risk and one Hibernating / Lost category (>90 days). Each actual centre remains visible; no K is forced to fit the naming list. Actual fitted-centre paths replace the previous business-group-mean movement diagram. Missing centre positions are not fabricated.

## Rebuild command

From the project root with pandas, NumPy, SciPy, scikit-learn, openpyxl, joblib, matplotlib and seaborn installed:

```powershell
python -c "import sys,json; from pathlib import Path; sys.path.insert(0,str(Path('model/pipeline b').resolve())); import csrs_model; print(json.dumps(csrs_model.rebuild_model(Path('model/pipeline b')),indent=2))"
```

A new timestamped directory is created. Existing runs are preserved. The rebuild saves data, models, current centre/quality registries, figures, semantic/migration evidence, cohort-quality diagnostics and the updated methodology SVG/PNG/PDF. It does not automatically change backend .env.

Evaluation exports are also generated automatically. To regenerate only the evaluation report and figures without fitting or changing the database, run `python 'model/pipeline b/export_evaluation_figures.py' --run-dir RUN`. This writes `evaluation_report.json`, four PNG/SVG figures and two source CSVs under `Research_Figures/Validation/`. Geographic metrics are checked against the saved scaled market features, assignments and fixed baseline centres. From `interface/frontend`, `node audit_evaluation_page.mjs ABSOLUTE_RUN_PATH` checks the direct services and actual React page rendering, without HTTP or a live browser review.

## Independent audits

Run against the new directory, replacing RUN with its path:

```powershell
python 'model/pipeline b/audit_preprocessing_steps.py' --run-dir RUN
python 'model/pipeline b/audit_current_mdfcm.py' --run-dir RUN
python 'model/pipeline b/audit_centroid_updates.py' --run-dir RUN
python 'model/pipeline b/audit_customer_risk.py' --run-dir RUN
python 'model/pipeline b/audit_semantic_migration.py' --run-dir RUN
python 'model/pipeline b/audit_population_quality.py' --run-dir RUN
python 'model/pipeline b/audit_mdfcm_branches.py' --output RUN/synthetic_branch_verification.json
```

Baseline/core preservation is additionally checked by `audit_population_scope.py --run-dir RUN --reference model/pipeline\ b/repair_outputs_2026-10-23/run_20261025_113044` (quote paths containing spaces). Build both frontend and backend. From interface/backend run `node audit_current_services.cjs ABSOLUTE_RUN_PATH`. This checks services directly without substituting for the separately deferred live browser review.

Configure interface/backend/.env with absolute DATABASE_PATH and ARTIFACT_ROOT for the new run, then start/restart the backend. The local app serves its built frontend at /CSRS/. Preserve hosted deployment settings unless a deployment is explicitly requested.

## Current evidence

| Cycle | Customers fitted | K | Inertia / hard WCSS | Silhouette ↑ | DB ↓ | CH ↑ | XB ↓ | Mean max membership |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 1,682 | 5 | 56.571 | 0.365 | 0.944 | 1,170.4 | — | — |
| 1 | 2,134 | 5 | 73.590 | 0.407 | 0.981 | 2,424.9 | 0.335 | 70.8% |
| 2 | 2,434 | 5 | 66.817 | 0.448 | 0.893 | 3,395.1 | 0.242 | 72.1% |
| 3 | 2,718 | 5 | 72.923 | 0.505 | 0.847 | 4,724.4 | 0.195 | 76.2% |
| 4 | 2,960 | 5 | 82.590 | 0.526 | 0.843 | 5,380.1 | 0.213 | 77.0% |
| 5 | 3,148 | 6 | 70.832 | 0.530 | 0.886 | 6,038.2 | 0.230 | 74.8% |
| 6 | 3,317 | 6 | 72.920 | 0.551 | 0.903 | 6,547.9 | 0.222 | 76.2% |
| 7 | 3,616 | 7 | 77.699 | 0.530 | 0.896 | 6,943.0 | 0.210 | 74.2% |
| 8 | 3,974 | 8 | 78.690 | 0.511 | 0.923 | 6,937.6 | 0.254 | 70.9% |
| 9 | 4,297 | 9 | 86.583 | 0.476 | 0.953 | 6,822.9 | 0.252 | 68.5% |

Production numerical/source/identity/risk audits and direct-service reconciliation pass for `run_20261025_195725`. The seven core function AST hashes match the pre-change computation lock. K−1 remains covered by synthetic checks because real-data conditions do not permit it. The current study has moderate purchaser-level overlap and partial semantic continuity; the full-population headline scores do not remove those limits.

## Approved naming revision

Current reporting output: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151`. Numerical fitting source: `run_20261025_195725`. The approved nine names are Champions; High-Value Regulars; Loyalists; Valuable Customers at Risk; Mid-Tier Occasionals; Occasional Buyers at Risk; Light Buyers; Light Buyers at Risk; Hibernating / Lost. The naming-only revision preserves K, all memberships/assignments/RFM/PCA values, fitted centres, outliers, model files and cycle metrics. Per-cluster silhouette, negative-silhouette share, membership strength, hard SSE, fuzzy-objective contribution and centre-distance summaries are exported in `per_cluster_quality.csv`; coordinates are in `per_cluster_centroids.csv`. Global DB/CH/XB remain cycle-level measures. The primary nine-profile movement plot uses actual centres, with dashed links for a changed tracking ID; the separate ID plot preserves the ten historical paths.
