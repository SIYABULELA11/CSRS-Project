# Current model and dashboard review — 25 October 2026

Authoritative run: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151/`. Local dashboard: http://localhost:4000/CSRS/.

This full-population rebuild supersedes `run_20261025_113044`. Its prior documentation is preserved in that run's `superseded_documentation_full_population/`. The hosted deployment has a separate deployment state.

## What changed

The former dynamic input selected only current-month purchasers and froze non-purchasers' memberships. The current input includes every customer observed before each cutoff and recalculates their RFM, PCA position and membership. Frequency and Monetary now use the same exact trailing 90 days in every cycle, divided by three for monthly equivalents. Recency uses all earlier qualifying history to find the latest purchase and remains uncapped. Lifetime spend is not used as rolling Monetary.

A customer with no current purchase can retain positive F/M until earlier purchases leave the window. Each snapshot replaces the prior snapshot for that customer. Historical carry-over mass is zero in these complete snapshots; previous centres provide initialization. This prevents repeated observations from accumulating extra weight. It is a disclosed input/update adaptation of the paper's new-object stream. With zero carry-over mass, the retained-K centre blend reduces to the current population's fuzzy centre update.

Cycle 0 remains static K-means at accepted K=5. Independent comparison finds **zero numeric change** in all baseline RFM, logged/interacted features, PCA coordinates and assignments. Seven locked core functions remain exactly unchanged by AST comparison, including standard FCM, incremental centre equations, MDFCM conditions/candidate selection, identity matching and metric functions.

## Data processing and commercial totals

1. Clean the UCI workbook: remove exact duplicate rows; require linked integer customer IDs, nonblank invoices, valid in-period dates, finite positive quantities/prices and non-cancellation invoices. Missing descriptions/countries receive explicit placeholders.
2. Build cutoff-safe customer snapshots for C0 and monthly C1–C9. Include everyone first observed before the snapshot. The study is `[2010-12-01,2011-12-01)`.
3. Derive exact Recency and trailing-90-day distinct paid-invoice Frequency /3 and positive paid-sales Monetary /3.
4. Apply log1p to R/F/M and form RF/RM/FM by multiplying corresponding logged values.
5. Fit the six-feature MinMaxScaler on Cycle 0 only and reuse it without clipping.
6. Fit three PCA components on scaled Cycle 0 only and reuse those axes in every cycle.

No stage is skipped. Independent source reconstruction checks **375,666** qualifying transaction rows, **4,297** distinct customers and **30,280** customer-cycle observations. The baseline contains **1,682** customers and exactly 90 days, so the accepted baseline fit is preserved. Current-period revenue/orders/products/quantities are stored separately from rolling features. Disjoint commercial periods reconcile to **£8,370,018.454** and **17,754 orders**. Summing rolling-window spend across cycles would count some purchases repeatedly and is not used for these totals.

## Computed model results

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

Cycle 0 inertia is **56.571298**: the sum of squared Euclidean distances to assigned fitted K-means centres in the three-dimensional PCA fitting space. Lower inertia indicates a tighter fit on the same data/scale, but tends to fall as K rises. Its WCSS elbow remains the primary K-selection rule; silhouette is supporting evidence. The dashboard includes the accepted-K elbow plot and silhouette-by-K plot. Crisp Cycle 0 assignments do not supply fuzzy confidence or Xie–Beni.

Dynamic mean silhouette is **0.49823**, DB **0.90279**, XB **0.23919**, and mean maximum membership **73.42%**. These internal scores support useful but overlapping structure. They do not measure commercial uplift or classification accuracy.

The observed K path is **5,5,5,5,5,6,6,7,8,9**. Condition 2 permits K and K+1 in all nine updates; the lower converged finite Xie–Beni candidate wins. K increases in C5/C7/C8/C9. Condition 1 never occurs, so no research-cycle K−1 operation is eligible or claimed. Synthetic cases separately exercise all four condition combinations and retain/decrease/increase branches. No synthetic output enters the research data.

## Interpretation limits exposed by the audit

Cycle 9 full-population silhouette is **0.4755**, mean maximum membership **68.47%**. Current-month purchasers alone have silhouette **0.2329** and membership **52.10%**; customers within 90 days have **0.2823** and **56.09%**. The >90-day cohort occupies one assigned centre and averages **92.61%** maximum membership, so it raises the overall score. Subset diagnostics retain the same model/assignments; they are not alternative fitted models. The former purchaser-only scores use different data and cannot establish an improvement by direct comparison. A high membership value is not a calibrated probability of a correct segment.

Every fitted centre is visible, including soft-only centres if any. Registry rows and unique display names match fitted K in every cycle; all current centres in this run have hard winners. Names are descriptive weighted-RFM labels from nine allowed categories, including **Valuable Customers at Risk** and one **Hibernating / Lost** category above 90 days. Names never determine K. The additional recent high-value centre in C9 is named High-Value Regulars under the approved descriptive taxonomy.

There are **61** fitted centre positions and **10** provisional tracking paths across all cycles; maximum simultaneous K is 9. One ID can retire and another appear. The primary movement plot groups actual fitted centres by approved profile name. Solid links retain the tracking ID; dashed links change ID. The separate tracking-ID view preserves lineage. Both mark C0–C9 and leave absent positions empty. Colours follow the current profile, with a separate darker green for High-Value Regulars.

Of **51** continuing ID links, **40** retain a descriptive name and **11** rename. These are rename events across cycles, not 11 simultaneous clusters. Perfect semantic persistence is not demonstrated. Profile rules are relative descriptive choices; the raw weighted RFM and profile history are exported for review.

Across **25,983** consecutive-customer comparisons, **14,905** ID migrations partition into **12,072** feature-only switches, **262** boundary-only switches, **1,906** where either change separately switches assignment, and **665** combined effects. Another **843** displayed-label changes keep the same ID. These are counterfactual geometric diagnostics, not causal proofs. See [the brief explanation](CLUSTER_IDENTITY_AND_MIGRATION.md).

Individual warning stages are At risk at 31–60 days, Slipping at 61–90, and Lost above 90; deterioration may flag earlier risk. Membership comparisons use the same stable ID and exclude crisp-to-fuzzy C0→C1 changes. At risk and Slipping combine in warning counts; Lost and No prior comparison are excluded from assessed warning-rate denominators. A cluster's descriptive name does not force every customer's individual warning status.

## Geographic, firmographic and product outputs

A separate geographic model fits **K-means K=3** on baseline country features, using log commercial measures, repeat-purchase rate and five broad behavioural-family shares plus Other. At-risk labels map to their broad family for those composition features. Baseline RobustScaler and geographic centres are frozen; later country snapshots use the same exact 90-day transaction window. K=3 is specified for market interpretation and is independent of behavioural elbow selection. Risk share is contextual, not a fitting feature.

Firmographic outputs are customer–market combinations; they do not establish verified company size or industry. Product totals use observed current-period paid purchases. Customer counts, hierarchy, palettes, PCA, risk analytics, geographic composition and firmographic combinations use the rebuilt labels. All cycles means customer-cycle observations, not distinct people.

## Verification evidence and remaining review

- `preprocessing_audit.json`: independently rebuilds every snapshot, transform and country prediction from the workbook.
- `population_scope_audit.json`: baseline unchanged, seven core functions unchanged, every current customer fitted exactly once, correct K/display counts and commercial totals.
- `independent_mdfcm_audit.json`: independent conditions, permitted candidates, memberships, objectives and validity scores.
- `centroid_update_audit.json`: nine retained alternatives, five selected retained updates, all 52 split initializations, four selected splits and 285 lineage rows independently replayed. Selected retained centre residual is at most `5.35e-15`; selected split-centre residual `2.23e-16`.
- `customer_risk_audit.json`: all 30,280 individual statuses/change values checked without mismatch.
- `semantic_cluster_audit.json`, migration CSVs and `population_quality_diagnostics.json`: actual continuity, feature/boundary comparisons and cohort quality.
- `synthetic_branch_verification.json`: all mathematical branches verified outside research results.
- `service_audit.json`: all 30,280 paginated observations, registry/PCA counts, risk filters, quality values, market/product/firmographic results and finances reconcile through direct application services.

Frontend/backend production builds, direct service checks and static figure review passed. The local server is running against this audited database and its built frontend. The previously deferred live browser visual review remains pending; direct service checks do not imply a completed live pixel review. This is a reproducible study adaptation of MDFCM, with moderate purchaser-level separation and documented semantic changes, not proof of stable ground-truth customer types.

## Fitted K and displayed-cluster reconciliation

The Model page now displays fitted K, registry entries, distinct display names, distinct PCA colours and customer-filter entries together for every cycle. All counts match: C0–C4 each5; C5–C6 each6; C7=7; C8=8; C9=9. Model-cluster numbers are also shown beside profile names. `cluster_count_display_audit.json` verifies the actual API data and frontend colour function, and independently recomputes all current quality measures with a maximum rounding residual below 1.2e-16. No clustering or preprocessing calculation changed in this display update.

C0 has Champions (111), Loyalists (252), Valuable Customers at Risk (278), Mid-Tier Occasionals (480), and Light Buyers at Risk (561). The earlier C4 K7 belonged to the purchaser-only run, superseded by the approved complete-population/90-day rebuild. C9 distinguishes Champions from High-Value Regulars using the approved names. The underlying centres and assignments are unchanged.

## Approved naming revision

Current reporting output: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151`. Numerical fitting source: `run_20261025_195725`. The approved nine names are Champions; High-Value Regulars; Loyalists; Valuable Customers at Risk; Mid-Tier Occasionals; Occasional Buyers at Risk; Light Buyers; Light Buyers at Risk; Hibernating / Lost. The naming-only revision preserves K, all memberships/assignments/RFM/PCA values, fitted centres, outliers, model files and cycle metrics. Per-cluster silhouette, negative-silhouette share, membership strength, hard SSE, fuzzy-objective contribution and centre-distance summaries are exported in `per_cluster_quality.csv`; coordinates are in `per_cluster_centroids.csv`. Global DB/CH/XB remain cycle-level measures. The primary nine-profile movement plot uses actual centres, with dashed links for a changed tracking ID; the separate ID plot preserves the ten historical paths.
