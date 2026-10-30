# Superseded audit — retained as historical evidence

**Do not use the assessment below as the current model verdict.** It refers to run_20261025_003555 and missed an infinite-diagonal error that disabled MDFCM Condition 2. The current rebuilt run is run_20261025_113044, with K path 5,5,5,6,7,7,7,8,8,8 and genuine additions in Cycles 3,4,7.

Use [Current model, data and dashboard review](CURRENT_MODEL_REVIEW_2026-10-25.md) and [MDFCM implementation status](MDFCM_PAPER_IMPLEMENTATION_STATUS.md). The earlier body is preserved below for traceability.

---

# MDFCM and dashboard post-fix audit

**Active run:** `model/pipeline b/repair_outputs_2026-10-23/run_20261025_003555/`  
**Database:** `csrs_pipeline_b_repaired.db`  
**Framework:** static Cycle 0 K-means at accepted K=5; MDFCM only in Cycles 1–9.

## Audit result

The implemented standard FCM calculations, MDFCM condition checks, and the selected incremental-centre update agree with the equations in Section 4.1 of the supplied paper, subject to the project adaptations listed below. The executed run is internally consistent and converges. It does **not** demonstrate a cluster-count increase or decrease: neither condition qualifies in any monthly batch, so the K=5 existing-centre movement branch is selected in every dynamic cycle. The changed-K branches are implemented but remain unexercised by this dataset and run.

The paper's Eq. 8 condition is evaluated against all fitted-centre memberships. Eq. 9 is evaluated against every distinct centre pair. If either condition applies, the permitted K alternatives are compared by Xie–Beni; if neither applies, the existing centres move using Eqs. 14–16. The FCM membership, centre, objective, and Xie–Beni equations use fuzzifier `m=2`. The convergence rule is an absolute objective change of at most `0.01`, with a 300-iteration cap.

## Independent checks against stored results

| Check | Result |
| --- | ---: |
| SQLite integrity | `ok` |
| Customers / qualifying paid-sale rows | 4,297 / 375,666 |
| Customer-cycle feature rows | 30,280 |
| Cycle 0 K-means population / K | 1,682 / 5 |
| Cycle 0 labels inconsistent with nearest stored K-means centre | 0 of 1,682 |
| Dynamic updates converged | 9 of 9, in 3–4 iterations |
| Dynamic K path | 5 in every Cycle 1–9 |
| Condition 1 / Condition 2 qualifying purchasers | 0 in every cycle |
| Selected dynamic operation | Incremental movement in all 9 cycles |
| Active fuzzy membership vectors not summing to one | 0 |
| Maximum difference from independently recomputed FCM memberships | `5.0e-9` |
| Maximum fuzzy-objective difference from the stored value | `3.6e-8` |
| Maximum Xie–Beni difference from the stored value | `7.8e-10` |
| Maximum centre residual from an independent Eq. 14–16 update | `0.000423` PCA units |
| Cycle 0 plus dynamic fitted-centre positions | 50 (five per cycle) |
| Dynamic fitted centres missing a lineage ID or RFM profile | 0 of 45 |

Cycle 0 uses the WCSS elbow as the primary K-selection evidence, as accepted in the project framework. K=5 has WCSS `56.5713`; silhouette is `0.36519` at K=5 and peaks at K=2 (`0.46445`). The silhouette preference differs, but it is supporting evidence and does not override the agreed elbow-first choice. PCA is fitted once on Cycle 0 and reused in later cycles; the three components explain approximately 99.05% of Cycle 0 feature variance.

## The fitted-centre and customer-label distinction

Each MDFCM cycle fits five fuzzy centres. Four centres win at least one current purchaser's largest-membership label; local centre 5 has positive fuzzy membership mass (about `36.2`–`59.5` summed memberships by cycle) but wins no largest-membership label. Therefore, the hard-label Silhouette, Davies–Bouldin, and Calinski–Harabasz scores describe four occupied labels. Xie–Beni and membership vectors use all five fitted centres. K=5 is the fitted fuzzy structure, not five equally populated hard customer groups.

The mean maximum membership for current fitted customers is `63.36%` across the dynamic cycles. It is a membership-strength summary, not a calibrated probability or proof of business usefulness. Mean silhouette is `0.29785`, mean Davies–Bouldin is `1.04651`, mean Calinski–Harabasz is `641.72`, mean Xie–Beni is `0.42659`, and comparable-customer migration is `62.86%`. Migration is a customer-movement measure, not a cluster-validity score. These are moderate internal results and should not be presented as strong validation of commercial value.

## Repairs applied to the assessment and outputs

1. **Retired-centre history wording:** the previous label treated any stored membership entry pointing to a retired ID as evidence that the customer's primary centre retired. Zero-membership entries caused false labels. The rebuilt model now distinguishes a retired primary centre from a retired secondary membership and ignores zero-valued memberships. An independent row-level audit found zero incorrect retained/retired labels. In Cycle 1, 456 inactive customers had a retired primary centre; 704 others correctly remain simply “Retained prior membership.”
2. **Centroid identity and profile lookup:** the dashboard and figure generator previously tried to identify a centre from active customers' largest-membership labels. That dropped a valid centre which had no hard-label winner. They now map every fitted local centre through `Cluster_Lineage` (primary continuation or explicit creation) and obtain its RFM profile from the full membership details. The interface and refreshed static figure now include all 50 fitted positions, with six provisional tracking IDs and no unlabelled centres.
3. **Cycle-evolution figure:** duplicate stable-ID rows that shared one customer-facing family could create multiple points at the same cycle. The figure now aggregates customer counts by cycle and displayed family before plotting.
4. **Dashboard interpretation:** the Model page reports hard-winning-centre counts and the soft-only centre numbers beside K. It states that K−1/K+1 branches were not exercised in this run and that tracking-ID creation/retirement is separate from an MDFCM change in K. Population summaries clarify that inactive customers retain their membership vectors; model validity scores use current-cycle fitted purchasers.
5. **Local site activation:** the backend now points at this run's database and figure directory, and its port-4000 process was restarted after the frontend and backend builds.

The Cycle 1 change from CL-005 to CL-006 is a tracking-lineage retirement and creation. K stayed at five; this was not a merge, split, or MDFCM structure change. The refreshed centroid figure visually shows the one-cycle tracking gap and the single fitted centre that has no hard-label winner.

## Disclosed limits

- This is a paper-aligned implementation within the required project framework, not a reproduction of every paper experiment. The paper initializes its dynamic process with FCM; this project requires static Cycle 0 K-means and uses those centres to start MDFCM in Cycle 1.
- The monthly purchaser batch, “condition is met if at least one purchaser qualifies” aggregation, removal/split starting points for changed-K candidates, and absolute-objective-change interpretation of `E_FCM=0.01` are documented project choices.
- Since all conditions are false here, changed-K FCM candidates have not been run on observed cycles. Their implementation can be inspected in source, but their empirical behaviour still needs a dataset/run that activates those conditions.
- Family names and At Risk / Hibernating states are post-fit RFM and recency interpretations. The stable IDs are provisional computational matches, not permanent customer types.
- PCA plots aid inspection but do not establish business value, causality, or a permanent customer grouping.

See [the active rebuild record](model/pipeline%20b/MODEL_REBUILD.md) and [paper-alignment notes](MDFCM_PAPER_IMPLEMENTATION_STATUS.md) for the full data-processing and method description.
