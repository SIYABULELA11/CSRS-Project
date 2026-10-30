# Project repair plan — current state, 25 October 2026

Authoritative rebuilt run: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151/`.

Prior plan/history: `model/pipeline b/repair_outputs_2026-10-23/run_20261025_113044/superseded_documentation_full_population/PROJECT_REPAIR_PLAN.md`.

| Work | State and evidence |
| --- | --- |
| Preserve accepted C0 K-means K5 | Complete. Every numeric baseline feature/PCA value/assignment matches exactly. Inertia (WCSS) 56.5713 and elbow evidence included. |
| Complete data processing | Complete. Source cleaning, cutoff snapshots, 90-day cascaded RFM, log1p, baseline MinMax and baseline PCA independently reconstructed for all 30,280 observations. |
| Include non-purchasers in updates | Complete. Every observed customer gets one fresh current snapshot and membership; 2,633 non-purchasers fitted in C9. |
| Avoid repeated-customer weighting | Complete. Current snapshots replace prior observations; historic mass is zero and old centres provide initialization. |
| Preserve FCM/MDFCM core | Complete. Seven core AST hashes unchanged; independent equations, candidates, objectives, centres and lineage pass. |
| Recompute all metrics and count consistency | Complete. K path 5,5,5,5,5,6,6,7,8,9; registry/PCA/customer counts reconcile. No fabricated branch events. |
| Supported labels and customer warnings | Complete. Valuable Customers at Risk available; single Hibernating / Lost >90 days. Individual At risk/Slipping/Lost and assessed warning denominators verified. |
| Actual centroid movement and palette | Complete. 61 real positions, 10 tracking lifespans, maximum simultaneous K9; all cycles labelled with genuine gaps and consistent colours. |
| Identity versus behavioural migration | Complete with limitation. 40/51 ID links keep names; 11 rename events. Counterfactual feature/boundary diagnostics expose the difference; semantic perfection is not claimed. |
| Explain overall versus purchaser quality | Complete. C9 all-population silhouette/membership 0.476/68.5%; purchasers 0.233/52.1%. Dormant observations raise the headline. |
| Geographic, customer-market and product analytics | Complete. K3 market method documented; rolling features and separate period totals checked. |
| Dashboard and directory outputs | Complete. Production builds and all direct service checks pass; localhost:4000 serves the current run and built frontend. |
| Live browser pixel review | Deferred by the user; remains pending. |

Read [the current review](CURRENT_MODEL_REVIEW_2026-10-25.md) and [brief identity/migration report](CLUSTER_IDENTITY_AND_MIGRATION.md). The model is a documented study adaptation with moderate purchaser-level separation and imperfect semantic persistence. Further scientific improvement should compare equivalent populations and preserve honest validation; confidence should not be inflated by altering the fuzzifier or excluding difficult customers.

## Approved naming revision

Current reporting output: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151`. Numerical fitting source: `run_20261025_195725`. The approved nine names are Champions; High-Value Regulars; Loyalists; Valuable Customers at Risk; Mid-Tier Occasionals; Occasional Buyers at Risk; Light Buyers; Light Buyers at Risk; Hibernating / Lost. The naming-only revision preserves K, all memberships/assignments/RFM/PCA values, fitted centres, outliers, model files and cycle metrics. Per-cluster silhouette, negative-silhouette share, membership strength, hard SSE, fuzzy-objective contribution and centre-distance summaries are exported in `per_cluster_quality.csv`; coordinates are in `per_cluster_centroids.csv`. Global DB/CH/XB remain cycle-level measures. The primary nine-profile movement plot uses actual centres, with dashed links for a changed tracking ID; the separate ID plot preserves the ten historical paths.
