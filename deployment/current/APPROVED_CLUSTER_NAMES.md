# Approved cluster names and per-cluster diagnostics

This is a reporting-only revision of `run_20261025_195725`; all numerical model outputs remain unchanged.

| Name | Description |
| --- | --- |
| Champions | The freshest high-value repeat-purchase profile. |
| High-Value Regulars | Strong repeat purchasing and spending with a slightly longer purchase gap than the freshest Champions profile. |
| Loyalists | A recent, moderate-value repeat-purchase profile. |
| Valuable Customers at Risk | Meaningful rolling-window purchasing value with a longer purchase gap; this does not establish a previous Loyalists assignment. |
| Mid-Tier Occasionals | Recent purchasing with moderate value and less frequent ordering than the strongest repeat-purchase profiles. |
| Occasional Buyers at Risk | Infrequent purchasing with a substantial purchase gap. |
| Light Buyers | Relatively low-frequency, lower-spending customers who purchased recently; growth is not assumed. |
| Light Buyers at Risk | A light purchasing profile with a longer purchase gap. |
| Hibernating / Lost | Predominantly customers without purchases for more than 90 days; individuals can differ from the weighted profile. |

Per-cluster outputs: `per_cluster_quality.csv`, `per_cluster_centroids.csv`, and `current_cluster_profiles.csv`. The Model page offers all cycles; the PCA page shows the selected cycle.

The primary PCA centroid figure has one panel per approved name. Solid lines retain a tracking ID, dashed lines change it; missing names leave gaps. The separate fitted-ID figure retains the actual lineage paths. No centre or point was refitted or invented.

Within-cluster SSE and fuzzy-objective contributions sum to their cycle totals. Mean silhouette is the average of the assigned customers’ silhouette values in the complete 3D partition. DB, CH and XB remain global measures.