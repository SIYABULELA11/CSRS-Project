# Cluster identity and customer migration

Current evidence: `named_20261025_214151`. Cycle 0 uses static K-means, K=5. Cycles 1–9 use the existing FCM/MDFCM calculations with updated customer snapshots.

**Customers considered.** Every customer observed before a cycle cutoff receives fresh RFM and membership, including non-purchasers. Recency is uncapped days since the latest purchase. Frequency and positive paid sales use the preceding 90 days, divided by three for monthly equivalents. Earlier purchases remain represented until they leave that window. Lifetime history establishes eligibility and the latest purchase date; lifetime spending does not replace rolling spending. Monthly commercial totals are separate, avoiding repeated revenue from overlapping windows. Each current snapshot replaces the previous one, so historical membership mass is zero in this run; previous centres provide initialization.

**Cluster identity consistency.** Provisional CL IDs link centres using distance and fuzzy customer overlap. Descriptive names are checked separately against membership-weighted RFM. All 61 fitted profiles meet their documented recency eligibility. Of 51 consecutive links, 40 keep their name and 11 change it. Therefore perfect semantic continuity is **not demonstrated**. Relative frequency/spend prototypes are transparent reporting choices, not externally validated customer classes. A continuing ID alone cannot establish that Champions remain Champions.

**Behavioural migration.** For each returning customer, assign current features to old centres and old features to current centres, then compare both with the actual current assignment. All coordinates use the frozen Cycle 0 scaler/PCA. Across 25,983 comparisons, 14,905 tracking-ID changes comprise:

- 12,072: feature change alone switches assignment; boundary change alone does not.
- 262: boundary change alone switches assignment; feature change alone does not.
- 1,906: either change separately switches assignment.
- 665: the changes together switch assignment.

Another 843 displayed-name changes keep the same tracking ID. These checks distinguish geometric explanations; they do not prove causal behaviour changes.

**Labels and quality.** The approved names include High-Value Regulars, Valuable Customers at Risk, Occasional Buyers at Risk, Light Buyers and Light Buyers at Risk. Hibernating / Lost remains one category above 90 days. Individual warnings use At risk at 31–60 days, Slipping at 61–90, and Lost above 90; deterioration can trigger earlier warnings. Names describe cluster profiles, so individual customers may differ. Fitted K is never changed to satisfy the naming list; a qualified name preserves an extra genuine centre where needed. K selection uses the accepted baseline elbow and dynamic condition-permitted Xie–Beni comparisons. Silhouette, DB, CH and maximum membership provide additional evidence. Greater membership alone does not prove a better model, and comparisons with the former purchaser-only run have different populations.

Detailed evidence: `semantic_cluster_audit.json`, `cluster_identity_profile_history.csv`, and `customer_migration_diagnostics.csv`. The Model page displays the checks and cycle counts.
