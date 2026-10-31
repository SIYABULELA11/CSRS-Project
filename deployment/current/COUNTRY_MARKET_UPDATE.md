# Country-market segmentation and behavioural integration

The country-market model now fits six commercial inputs only: customer count, paid sales, invoices per active customer, sales per active customer, distinct product-description count and repeat-purchase rate. The first five use log1p; all six use the Cycle 0 RobustScaler. Behavioural profile shares remain contextual outputs, not fit inputs. There is no country-market PCA.

Cycle 0 evaluates K=2–10 with 50 K-means starts and seed 42. The normalized WCSS endpoint-chord elbow selects K=4; inertia is 46.5488 and silhouette is 0.2958. Silhouette instead favours K=3 (0.4204). The elbow is shallow and the UK singleton is disclosed. Interpretation supports reporting the selected groups; labels do not determine numeric fitting.

The four baseline labels are UK-Dominated Market, High-Spend-per-Customer Markets, Higher-Repeat Overseas Markets and Lower-Volume Occasional-Purchase Markets. These are relative baseline descriptions, not country-wide economic classifications or permanent guarantees. Later cycles assign the current country features to the same saved centres using the same scaler; no later-country refit or MDFCM is performed.

For integration, each customer-cycle is joined to their country as known at that cutoff, then to the country-market group and their existing behavioural profile. The matrix reports counts and commercial context for those combinations. This is cross-classification, not a third clustering fit, and provides no verified company-size, industry or ownership information.

All 17 unrelated database tables and saved behavioural scaler/PCA/K-means parameters were checked unchanged. Customer preprocessing, behavioural K choices, MDFCM updates, memberships, tracking and metrics were preserved. There are 4,297 unique customers and 31 occupied combinations at Cycle 9.

## Updated country-market metrics

| Cycle | Markets | Occupied groups | Silhouette | DB | CH |
|---|---:|---:|---:|---:|---:|
| Cycle_0 | 29 | 4 | 0.2958 | 0.8052 | 16.69 |
| Cycle_1 | 30 | 4 | 0.2885 | 0.7468 | 9.58 |
| Cycle_2 | 34 | 4 | 0.2592 | 0.7684 | 10.05 |
| Cycle_3 | 35 | 4 | 0.1254 | 0.8509 | 7.85 |
| Cycle_4 | 36 | 4 | 0.0839 | 1.0251 | 7.55 |
| Cycle_5 | 36 | 4 | 0.2137 | 0.9009 | 10.30 |
| Cycle_6 | 36 | 4 | 0.3375 | 0.7421 | 16.00 |
| Cycle_7 | 36 | 4 | 0.2536 | 0.7812 | 12.31 |
| Cycle_8 | 37 | 4 | 0.3190 | 0.7129 | 15.41 |
| Cycle_9 | 37 | 4 | 0.3090 | 0.6864 | 15.86 |
