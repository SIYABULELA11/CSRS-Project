# MDFCM implementation status — 25 October 2026

Current executed run: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151/`. See the [current review](CURRENT_MODEL_REVIEW_2026-10-25.md) and [brief semantic/migration evidence](CLUSTER_IDENTITY_AND_MIGRATION.md).

## Framework and preserved computation

Cycle 0 uses static K-means at accepted WCSS-elbow K=5, with crisp assignments. Validation includes **inertia 56.5713**, silhouette, DB and CH; the elbow plot remains in the dashboard. The archived C0 FCM experiment is never loaded. MDFCM runs only in C1–C9, initialized from prior centres. All seven previously locked core functions remain unchanged by AST comparison.

Standard FCM computes normalized inverse-distance memberships, handles exact centre matches, updates centres with u^m weights, uses objective J=sum(u^m*d^2), and evaluates Xie–Beni as J/(N*minimum distinct-centre squared distance). Here m=2. A candidate must converge at absolute objective change <=0.01 within 300 iterations and have finite XB. This is an explicit objective tolerance, not a guarantee of a global optimum.

Condition 1 identifies observations whose memberships are all within alpha=0.05 of 1/K. Condition 2 requires an observation's distance from every prior centre to exceed half that centre's farthest distinct-centre separation. Self-pairs are excluded from that maximum with zero; the minimum-separation XB calculation excludes self-pairs with infinity. A batch activates a condition if any observation qualifies.

| Condition 1 | Condition 2 | Permitted K |
| --- | --- | --- |
| False | False | K |
| True | False | valid K−1, K+1 |
| False | True | K, K+1 |
| True | True | valid K−1, K, K+1 |

Retained K uses the existing incremental centre blend (Eqs. 14–16). Changed-K starts try each centre elimination or principal-direction split, then standard FCM; select the lowest converged finite XB.

## Full-population snapshot adaptation

Every customer observed before the cutoff enters the current fit, including current-month non-purchasers. Exact Recency and trailing-90-day Frequency/Monetary /3 are recalculated. C0 already spans exactly 90 days, so its numeric baseline is unchanged. The C0 MinMax and three-component PCA transformations remain frozen.

Each customer's current snapshot replaces the old one. Prior membership mass represents only old IDs absent from the incoming snapshot; all previous IDs are present here, so that mass is **zero**. The retained-K blend consequently reduces to the current-population fuzzy centre update initialized from prior centres. This replacement-snapshot approach is a disclosed adaptation of the paper's incremental new-object stream. It must not be described as accumulating each repeated snapshot as another independent customer.

Other disclosed choices are K-means baseline initialization, any-observation condition aggregation, split/elimination starts, the interpretation of E_FCM as absolute objective change, and internal XB selection among eligible local fits. This is a study adaptation, not full paper replication.

## Actual results and audit

K path: **5,5,5,5,5,6,6,7,8,9**. Condition 1 is false in every retail update. Condition 2 is true in all nine batches. Five updates retain K; four select K+1. No decrease is claimed for the research run. Independent synthetic cases exercise decrease, increase, retention and every condition combination, and never enter research metrics.

Independent checks reconstruct nine retained candidates, five selected retained centre updates, 52 split starts, four selected increases and 285 lineage rows. Selected retained centre error <=5.35e-15; selected split-centre error <=2.23e-16; membership serialization error <5.0e-9. Raw-source processing verifies all 30,280 customer-cycle rows and every transformation. The audit files are listed in the current review.

Names are reporting interpretations of u^2-weighted RFM, with supported categories and unique qualifiers where needed. They do not change K or memberships. Hibernating / Lost remains one category at >90 weighted recency; individual Lost status uses individual recency. Stable IDs track geometric/membership continuity separately from names. Eleven rename events among 51 ID links demonstrate imperfect semantic persistence. The Model page reports feature/boundary migration diagnostics, rather than assuming every assignment change is behavioural.

Overall dynamic mean silhouette is 0.498 and mean maximum membership 73.4%, but C9 purchasers have only 0.233 silhouette and 52.1% membership. Dormancy raises aggregate scores. Confidence alone is therefore not used to claim a superior model or choose which customers to exclude. No ground-truth classes, validated churn probabilities, causal business uplift or guaranteed semantic stability are supplied by this dataset.

## Approved naming revision

Current reporting output: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151`. Numerical fitting source: `run_20261025_195725`. The approved nine names are Champions; High-Value Regulars; Loyalists; Valuable Customers at Risk; Mid-Tier Occasionals; Occasional Buyers at Risk; Light Buyers; Light Buyers at Risk; Hibernating / Lost. The naming-only revision preserves K, all memberships/assignments/RFM/PCA values, fitted centres, outliers, model files and cycle metrics. Per-cluster silhouette, negative-silhouette share, membership strength, hard SSE, fuzzy-objective contribution and centre-distance summaries are exported in `per_cluster_quality.csv`; coordinates are in `per_cluster_centroids.csv`. Global DB/CH/XB remain cycle-level measures. The primary nine-profile movement plot uses actual centres, with dashed links for a changed tracking ID; the separate ID plot preserves the ten historical paths.
