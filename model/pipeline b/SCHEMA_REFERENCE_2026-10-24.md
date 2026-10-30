> Historical schema reference. The current full-population run is documented in [SCHEMA_REFERENCE_2026-10-25.md](SCHEMA_REFERENCE_2026-10-25.md).

# Current SQLite schema reference — run 20261024_232347

**Database:** `model/pipeline b/repair_outputs_2026-10-23/run_20261024_232347/csrs_pipeline_b_repaired.db`

This reference is generated from the active rebuilt database. Cycle 0 uses the static K-means fields and hard assignments; MDFCM candidate, objective, Xie–Beni, and fuzzy membership data belong to Cycles 1–9. The historical schema snapshots in earlier run folders are not the active schema.

No table declares a primary key or foreign-key constraint. Unique indexes and ordinary indexes are listed per table. Relationships drawn in the companion schema diagram are inferred from shared fields, not enforced by SQLite.

## Tables and columns

### `Cluster_Lineage`

Rows in current run: 224

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `PreviousLocalCluster` | REAL | Yes | — | No |
| `CurrentLocalCluster` | REAL | Yes | — | No |
| `PreviousStableClusterID` | TEXT | Yes | — | No |
| `CurrentStableClusterID` | TEXT | Yes | — | No |
| `CentroidDistance` | REAL | Yes | — | No |
| `CustomerOverlapJaccard` | REAL | Yes | — | No |
| `MatchCost` | REAL | Yes | — | No |
| `LineageEvent` | TEXT | Yes | — | No |
| `IsPrimaryMatch` | INTEGER | Yes | — | No |

Indexes:
- None.

Declared foreign keys:
- None.

### `Customer`

Rows in current run: 4297

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CustomerID` | INTEGER | Yes | — | No |
| `Country` | TEXT | Yes | — | No |
| `FirstPurchaseDate` | TEXT | Yes | — | No |
| `LastPurchaseDate` | TEXT | Yes | — | No |

Indexes:
- `idx_customer_id`: UNIQUE on `CustomerID`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Customer_Transitions`

Rows in current run: 28598

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CustomerID` | INTEGER | Yes | — | No |
| `CycleID` | TEXT | Yes | — | No |
| `PreviousCycleID` | TEXT | Yes | — | No |
| `CurrentCycleID` | TEXT | Yes | — | No |
| `Cluster_Local_Index` | INTEGER | Yes | — | No |
| `MDFCM_Cluster_Number` | INTEGER | Yes | — | No |
| `Stable_Cluster_ID` | TEXT | Yes | — | No |
| `Previous_Stable_Cluster_ID` | TEXT | Yes | — | No |
| `Model_Profile_Name` | TEXT | Yes | — | No |
| `Segment_Name` | TEXT | Yes | — | No |
| `Previous_Segment_Name` | TEXT | Yes | — | No |
| `Previous_Cluster_Local_Index` | REAL | Yes | — | No |
| `Previous_Activity_Status` | TEXT | Yes | — | No |
| `Activity_Status` | TEXT | Yes | — | No |
| `Assignment_Mode` | TEXT | Yes | — | No |
| `Transition_Status` | TEXT | Yes | — | No |
| `Migration_Status` | TEXT | Yes | — | No |
| `Highest_Membership_Score` | REAL | Yes | — | No |
| `Fuzzy_Membership_Details` | TEXT | Yes | — | No |
| `Previous_Centroid_Assigned_Stable_ID` | TEXT | Yes | — | No |
| `Feature_Displacement` | REAL | Yes | — | No |
| `Migration_Cause` | TEXT | Yes | — | No |

Indexes:
- `idx_transition_cycle_status`: non-unique on `CycleID, Transition_Status`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Cycle_0_Elbow_Results`

Rows in current run: 9

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `K` | INTEGER | Yes | — | No |
| `Inertia` | REAL | Yes | — | No |
| `Within_Cluster_Sum_of_Squares` | REAL | Yes | — | No |
| `Silhouette_Score` | REAL | Yes | — | No |
| `Normalized_K` | REAL | Yes | — | No |
| `Normalized_Inertia` | REAL | Yes | — | No |
| `Elbow_Distance` | REAL | Yes | — | No |
| `Selected_K` | REAL | Yes | — | No |

Indexes:
- None.

Declared foreign keys:
- None.

### `Cycle_Definitions`

Rows in current run: 10

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `CycleNumber` | INTEGER | Yes | — | No |
| `PeriodStart` | TEXT | Yes | — | No |
| `PeriodEnd` | TEXT | Yes | — | No |
| `WindowStart` | TEXT | Yes | — | No |
| `SnapshotDate` | TEXT | Yes | — | No |
| `Phase` | TEXT | Yes | — | No |

Indexes:
- `idx_cycle_definition`: UNIQUE on `CycleID`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Data_Preprocessing_Results`

Rows in current run: 30280

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `PreprocessID` | INTEGER | Yes | — | No |
| `CustomerID` | INTEGER | Yes | — | No |
| `CycleID` | TEXT | Yes | — | No |
| `Cycle_End_Date` | TEXT | Yes | — | No |
| `Window_Start_Date` | TEXT | Yes | — | No |
| `Frequency_Monetary_Period_Start` | TEXT | Yes | — | No |
| `Frequency_Monetary_Period_End` | TEXT | Yes | — | No |
| `Frequency_Monetary_Period_Months` | INTEGER | Yes | — | No |
| `FirstPurchaseDate` | TEXT | Yes | — | No |
| `LatestPurchaseDate` | TEXT | Yes | — | No |
| `Activity_Status` | TEXT | Yes | — | No |
| `Lifecycle_Status` | TEXT | Yes | — | No |
| `Model_Profile_Name` | TEXT | Yes | — | No |
| `Is_New` | INTEGER | Yes | — | No |
| `Recency` | INTEGER | Yes | — | No |
| `Has_Purchase_In_Recency_Window` | INTEGER | Yes | — | No |
| `Frequency` | REAL | Yes | — | No |
| `Monetary` | REAL | Yes | — | No |
| `Products` | REAL | Yes | — | No |
| `Quantity` | REAL | Yes | — | No |
| `Recency_Bucket` | TEXT | Yes | — | No |
| `Log_R` | REAL | Yes | — | No |
| `Log_F` | REAL | Yes | — | No |
| `Log_M` | REAL | Yes | — | No |
| `RF_Score` | REAL | Yes | — | No |
| `RM_Score` | REAL | Yes | — | No |
| `FM_Score` | REAL | Yes | — | No |
| `Scaled_Log_R` | REAL | Yes | — | No |
| `Scaled_Log_F` | REAL | Yes | — | No |
| `Scaled_Log_M` | REAL | Yes | — | No |
| `Scaled_RF_Score` | REAL | Yes | — | No |
| `Scaled_RM_Score` | REAL | Yes | — | No |
| `Scaled_FM_Score` | REAL | Yes | — | No |
| `PC1` | REAL | Yes | — | No |
| `PC2` | REAL | Yes | — | No |
| `PC3` | REAL | Yes | — | No |

Indexes:
- `idx_preprocessing_customer_cycle`: non-unique on `CustomerID, CycleID`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Dynamic_Business_Analytics`

Rows in current run: 309302

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `InvoiceNo` | TEXT | Yes | — | No |
| `StockCode` | TEXT | Yes | — | No |
| `Description` | TEXT | Yes | — | No |
| `Quantity` | INTEGER | Yes | — | No |
| `InvoiceDate` | TEXT | Yes | — | No |
| `UnitPrice` | REAL | Yes | — | No |
| `CustomerID` | INTEGER | Yes | — | No |
| `Country` | TEXT | Yes | — | No |
| `Stable_Cluster_ID` | TEXT | Yes | — | No |
| `Total_Price` | REAL | Yes | — | No |
| `CycleID` | TEXT | Yes | — | No |
| `Revenue` | REAL | Yes | — | No |
| `Segment_Name` | TEXT | Yes | — | No |

Indexes:
- `idx_business_cycle_country`: non-unique on `CycleID, Country`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Dynamic_Centroids`

Rows in current run: 45

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `ClusterID` | INTEGER | Yes | — | No |
| `PC1` | REAL | Yes | — | No |
| `PC2` | REAL | Yes | — | No |
| `PC3` | REAL | Yes | — | No |

Indexes:
- None.

Declared foreign keys:
- None.

### `Dynamic_Customer_Summary`

Rows in current run: 28598

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `CustomerID` | INTEGER | Yes | — | No |
| `Cluster_Local_Index` | INTEGER | Yes | — | No |
| `Stable_Cluster_ID` | TEXT | Yes | — | No |
| `Segment_Name` | TEXT | Yes | — | No |
| `Activity_Status` | TEXT | Yes | — | No |
| `Assignment_Mode` | TEXT | Yes | — | No |
| `Orders` | REAL | Yes | — | No |
| `Products` | REAL | Yes | — | No |
| `Quantity` | REAL | Yes | — | No |
| `Revenue` | REAL | Yes | — | No |
| `Average_Membership` | REAL | Yes | — | No |
| `Migration_Status` | TEXT | Yes | — | No |
| `Transition_Status` | TEXT | Yes | — | No |
| `Average_Basket_Value` | REAL | Yes | — | No |

Indexes:
- `idx_customer_summary_cycle`: non-unique on `CycleID, CustomerID`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Dynamic_Cycle_Summary`

Rows in current run: 9

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `CustomersProcessed` | INTEGER | Yes | — | No |
| `ModelFitCustomers` | INTEGER | Yes | — | No |
| `RetainedInactiveCustomers` | INTEGER | Yes | — | No |
| `ActiveCustomers` | INTEGER | Yes | — | No |
| `InactiveCustomers` | INTEGER | Yes | — | No |
| `NewCustomers` | INTEGER | Yes | — | No |
| `ReactivatedCustomers` | INTEGER | Yes | — | No |
| `StableCustomers` | INTEGER | Yes | — | No |
| `MigratedCustomers` | INTEGER | Yes | — | No |
| `ComparableCustomers` | INTEGER | Yes | — | No |
| `MigrationRate` | REAL | Yes | — | No |
| `CentroidShift` | REAL | Yes | — | No |
| `Iterations` | INTEGER | Yes | — | No |
| `SelectedK` | INTEGER | Yes | — | No |
| `Condition1Met` | INTEGER | Yes | — | No |
| `Condition2Met` | INTEGER | Yes | — | No |
| `Condition1ObservationCount` | INTEGER | Yes | — | No |
| `Condition2ObservationCount` | INTEGER | Yes | — | No |
| `MDFCMDecision` | TEXT | Yes | — | No |
| `SelectedOperation` | TEXT | Yes | — | No |
| `SelectedSourceLocalClusters` | TEXT | Yes | — | No |
| `SelectedSourceStableClusterIDs` | TEXT | Yes | — | No |
| `SelectedResultLocalClusters` | TEXT | Yes | — | No |
| `SelectedResultStableClusterIDs` | TEXT | Yes | — | No |
| `CandidateXB` | TEXT | Yes | — | No |
| `MDFCMAlpha` | REAL | Yes | — | No |
| `Fuzziness` | REAL | Yes | — | No |
| `ConvergenceTolerance` | REAL | Yes | — | No |
| `ConvergenceCriterion` | TEXT | Yes | — | No |
| `SilhouetteScore` | REAL | Yes | — | No |
| `DaviesBouldinScore` | REAL | Yes | — | No |
| `CalinskiHarabaszScore` | REAL | Yes | — | No |
| `XieBeniIndex` | REAL | Yes | — | No |
| `FuzzyObjective` | REAL | Yes | — | No |
| `AverageMembership` | REAL | Yes | — | No |
| `NetGrossMonetaryRankCorrelation` | REAL | Yes | — | No |
| `MonetaryRankQuartileChangedCustomers` | REAL | Yes | — | No |
| `MonetaryRankQuartileChangedShare` | REAL | Yes | — | No |
| `ProcessingTime` | REAL | Yes | — | No |
| `ProcessingDate` | TEXT | Yes | — | No |
| `Converged` | INTEGER | Yes | — | No |

Indexes:
- None.

Declared foreign keys:
- None.

### `Dynamic_Loop_Results`

Rows in current run: 28598

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `DynamicID` | INTEGER | Yes | — | No |
| `CustomerID` | INTEGER | Yes | — | No |
| `CycleID` | TEXT | Yes | — | No |
| `PreviousCycleID` | TEXT | Yes | — | No |
| `CurrentCycleID` | TEXT | Yes | — | No |
| `Previous_Cluster_Local_Index` | REAL | Yes | — | No |
| `Previous_Stable_Cluster_ID` | TEXT | Yes | — | No |
| `Previous_Segment_Name` | TEXT | Yes | — | No |
| `MDFCM_Cluster_Number` | INTEGER | Yes | — | No |
| `Cluster_Local_Index` | INTEGER | Yes | — | No |
| `Stable_Cluster_ID` | TEXT | Yes | — | No |
| `Highest_Membership_Score` | REAL | Yes | — | No |
| `All_Fuzzy_Memberships` | TEXT | Yes | — | No |
| `Fuzzy_Membership_Details` | TEXT | Yes | — | No |
| `Migration_Status` | TEXT | Yes | — | No |
| `Transition_Status` | TEXT | Yes | — | No |
| `Previous_Activity_Status` | TEXT | Yes | — | No |
| `Activity_Status` | TEXT | Yes | — | No |
| `Lifecycle_Status` | TEXT | Yes | — | No |
| `Assignment_Mode` | TEXT | Yes | — | No |
| `Model_Profile_Name` | TEXT | Yes | — | No |
| `Segment_Name` | TEXT | Yes | — | No |
| `Updated_Centroids` | TEXT | Yes | — | No |
| `Dynamic_Silhouette_Score` | REAL | Yes | — | No |
| `Fuzzy_Objective` | REAL | Yes | — | No |
| `Xie_Beni_Index` | REAL | Yes | — | No |
| `MDFCM_Condition_1_Met` | INTEGER | Yes | — | No |
| `MDFCM_Condition_2_Met` | INTEGER | Yes | — | No |
| `MDFCM_Condition_1_Count` | INTEGER | Yes | — | No |
| `MDFCM_Condition_2_Count` | INTEGER | Yes | — | No |
| `MDFCM_Decision` | TEXT | Yes | — | No |
| `MDFCM_Selected_K` | INTEGER | Yes | — | No |
| `MDFCM_Candidate_XB` | TEXT | Yes | — | No |
| `MDFCM_Alpha` | REAL | Yes | — | No |
| `MDFCM_Fuzziness` | REAL | Yes | — | No |
| `MDFCM_Convergence_Tolerance` | REAL | Yes | — | No |
| `MDFCM_Convergence_Criterion` | TEXT | Yes | — | No |

Indexes:
- `idx_dynamic_customer_cycle`: non-unique on `CustomerID, CycleID`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Dynamic_Product_Summary`

Rows in current run: 62938

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `Stable_Cluster_ID` | TEXT | Yes | — | No |
| `Segment_Name` | TEXT | Yes | — | No |
| `Description` | TEXT | Yes | — | No |
| `Quantity_Sold` | INTEGER | Yes | — | No |
| `Revenue` | REAL | Yes | — | No |
| `Customer_Count` | INTEGER | Yes | — | No |
| `Orders` | INTEGER | Yes | — | No |
| `Average_Price` | REAL | Yes | — | No |

Indexes:
- `idx_product_summary_cycle`: non-unique on `CycleID, Segment_Name`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Dynamic_Segment_Summary`

Rows in current run: 117

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `Stable_Cluster_ID` | TEXT | Yes | — | No |
| `Segment_Name` | TEXT | Yes | — | No |
| `Customers` | INTEGER | Yes | — | No |
| `Orders` | REAL | Yes | — | No |
| `Quantity` | REAL | Yes | — | No |
| `Revenue` | REAL | Yes | — | No |
| `Average_Membership` | REAL | Yes | — | No |
| `Average_Order_Value` | REAL | Yes | — | No |
| `Revenue_Per_Customer` | REAL | Yes | — | No |

Indexes:
- `idx_segment_summary_cycle`: non-unique on `CycleID, Segment_Name`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Firmographic_Customer_Segmentation`

Rows in current run: 30280

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CustomerID` | INTEGER | Yes | — | No |
| `CycleID` | TEXT | Yes | — | No |
| `Segment_Name` | TEXT | Yes | — | No |
| `Activity_Status` | TEXT | Yes | — | No |
| `Highest_Membership_Score` | REAL | Yes | — | No |
| `Country` | TEXT | Yes | — | No |
| `Geographic_Cluster_Number` | INTEGER | Yes | — | No |
| `Geographic_Segment_Name` | TEXT | Yes | — | No |
| `Firmographic_Segment_Name` | TEXT | Yes | — | No |

Indexes:
- `idx_firmographic_cycle_customer`: non-unique on `CycleID, CustomerID`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `Geographic_Cycle_Summary`

Rows in current run: 10

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `Markets` | INTEGER | Yes | — | No |
| `SilhouetteScore` | REAL | Yes | — | No |
| `DaviesBouldinScore` | REAL | Yes | — | No |
| `CalinskiHarabaszScore` | REAL | Yes | — | No |

Indexes:
- None.

Declared foreign keys:
- None.

### `Geographic_Market_Features`

Rows in current run: 346

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `Country` | TEXT | Yes | — | No |
| `Revenue` | REAL | Yes | — | No |
| `Quantity` | REAL | Yes | — | No |
| `Active_Customer_Count` | REAL | Yes | — | No |
| `Orders` | REAL | Yes | — | No |
| `Product_Diversity` | REAL | Yes | — | No |
| `Repeat_Purchase_Rate` | REAL | Yes | — | No |
| `Customer_Count` | INTEGER | Yes | — | No |
| `Champions_Share` | REAL | Yes | — | No |
| `Champions_At_Risk_Share` | REAL | Yes | — | No |
| `Loyalists_Share` | REAL | Yes | — | No |
| `Loyalists_At_Risk_Share` | REAL | Yes | — | No |
| `Mid_Tier_Occasionals_Share` | REAL | Yes | — | No |
| `Mid_Tier_Occasionals_At_Risk_Share` | REAL | Yes | — | No |
| `Developing_Share` | REAL | Yes | — | No |
| `Developing_At_Risk_Share` | REAL | Yes | — | No |
| `Hibernating_Lost_Share` | REAL | Yes | — | No |
| `Other_Customer_Segment_Share` | REAL | Yes | — | No |
| `Orders_Per_Customer` | REAL | Yes | — | No |
| `Revenue_Per_Customer` | REAL | Yes | — | No |
| `Log_Customer_Count` | REAL | Yes | — | No |
| `Log_Revenue` | REAL | Yes | — | No |
| `Log_Orders_Per_Customer` | REAL | Yes | — | No |
| `Log_Revenue_Per_Customer` | REAL | Yes | — | No |
| `Log_Product_Diversity` | REAL | Yes | — | No |
| `CycleID` | TEXT | Yes | — | No |
| `Cycle_End_Date` | TEXT | Yes | — | No |
| `Geographic_Cluster_Number` | INTEGER | Yes | — | No |
| `Geographic_Segment_Name` | TEXT | Yes | — | No |
| `Scaled_Log_Customer_Count` | REAL | Yes | — | No |
| `Scaled_Log_Revenue` | REAL | Yes | — | No |
| `Scaled_Log_Orders_Per_Customer` | REAL | Yes | — | No |
| `Scaled_Log_Revenue_Per_Customer` | REAL | Yes | — | No |
| `Scaled_Log_Product_Diversity` | REAL | Yes | — | No |
| `Scaled_Repeat_Purchase_Rate` | REAL | Yes | — | No |
| `Scaled_Champions_Share` | REAL | Yes | — | No |
| `Scaled_Champions_At_Risk_Share` | REAL | Yes | — | No |
| `Scaled_Loyalists_Share` | REAL | Yes | — | No |
| `Scaled_Loyalists_At_Risk_Share` | REAL | Yes | — | No |
| `Scaled_Mid_Tier_Occasionals_Share` | REAL | Yes | — | No |
| `Scaled_Mid_Tier_Occasionals_At_Risk_Share` | REAL | Yes | — | No |
| `Scaled_Developing_Share` | REAL | Yes | — | No |
| `Scaled_Developing_At_Risk_Share` | REAL | Yes | — | No |
| `Scaled_Hibernating_Lost_Share` | REAL | Yes | — | No |
| `Scaled_Other_Customer_Segment_Share` | REAL | Yes | — | No |

Indexes:
- None.

Declared foreign keys:
- None.

### `Geographic_Segmentation`

Rows in current run: 346

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `Country` | TEXT | Yes | — | No |
| `Geographic_Cluster_Number` | INTEGER | Yes | — | No |
| `Geographic_Segment_Name` | TEXT | Yes | — | No |
| `Customer_Count` | INTEGER | Yes | — | No |
| `Active_Customer_Count` | REAL | Yes | — | No |
| `Revenue` | REAL | Yes | — | No |
| `Orders` | REAL | Yes | — | No |
| `Product_Diversity` | REAL | Yes | — | No |
| `Orders_Per_Customer` | REAL | Yes | — | No |
| `Revenue_Per_Customer` | REAL | Yes | — | No |
| `Repeat_Purchase_Rate` | REAL | Yes | — | No |
| `Champions_Share` | REAL | Yes | — | No |
| `Loyalists_Share` | REAL | Yes | — | No |
| `Loyalists_At_Risk_Share` | REAL | Yes | — | No |
| `Mid_Tier_Occasionals_Share` | REAL | Yes | — | No |
| `Mid_Tier_Occasionals_At_Risk_Share` | REAL | Yes | — | No |
| `Developing_Share` | REAL | Yes | — | No |
| `Developing_At_Risk_Share` | REAL | Yes | — | No |
| `Champions_At_Risk_Share` | REAL | Yes | — | No |
| `Hibernating_Lost_Share` | REAL | Yes | — | No |

Indexes:
- `idx_geo_cycle_country`: non-unique on `CycleID, Country`; origin `c`; partial=False.

Declared foreign keys:
- None.

### `MDFCM_Candidate_Evaluations`

Rows in current run: 9

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `CycleID` | TEXT | Yes | — | No |
| `PreviousK` | INTEGER | Yes | — | No |
| `CandidateK` | INTEGER | Yes | — | No |
| `InitializationAction` | TEXT | Yes | — | No |
| `SourceLocalClusters` | TEXT | Yes | — | No |
| `SourceStableClusterIDs` | TEXT | Yes | — | No |
| `ResultLocalClusters` | TEXT | Yes | — | No |
| `ResultStableClusterIDs` | TEXT | Yes | — | No |
| `XieBeniIndex` | REAL | Yes | — | No |
| `FuzzyObjective` | REAL | Yes | — | No |
| `Iterations` | INTEGER | Yes | — | No |
| `Converged` | INTEGER | Yes | — | No |
| `FinalMembershipChange` | REAL | Yes | — | No |
| `FinalObjectiveChange` | REAL | Yes | — | No |
| `ConvergenceTolerance` | REAL | Yes | — | No |
| `Selected` | INTEGER | Yes | — | No |

Indexes:
- None.

Declared foreign keys:
- None.

### `Model_Metadata`

Rows in current run: 16

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `MetadataKey` | TEXT | Yes | — | No |
| `MetadataValue` | TEXT | Yes | — | No |

Indexes:
- None.

Declared foreign keys:
- None.

### `Time_Cycle_0_Segmentation`

Rows in current run: 1682

| Column | SQLite type | Nullable | Default | Declared PK |
| --- | --- | --- | --- | --- |
| `Cycle0_ID` | INTEGER | Yes | — | No |
| `CustomerID` | INTEGER | Yes | — | No |
| `Cluster_Local_Index` | INTEGER | Yes | — | No |
| `Stable_Cluster_ID` | TEXT | Yes | — | No |
| `KMeans_Cluster_Number` | INTEGER | Yes | — | No |
| `Segment_Name` | TEXT | Yes | — | No |
| `Recency` | INTEGER | Yes | — | No |
| `Frequency` | REAL | Yes | — | No |
| `Monetary` | REAL | Yes | — | No |
| `All_Fuzzy_Memberships` | TEXT | Yes | — | No |
| `Fuzzy_Membership_Details` | TEXT | Yes | — | No |
| `PC1` | REAL | Yes | — | No |
| `PC2` | REAL | Yes | — | No |
| `PC3` | REAL | Yes | — | No |
| `Optimal_K_Value` | INTEGER | Yes | — | No |
| `Elbow_Inertia_Value` | REAL | Yes | — | No |
| `Silhouette_Score` | REAL | Yes | — | No |
| `Davies_Bouldin_Score` | REAL | Yes | — | No |
| `Calinski_Harabasz_Score` | REAL | Yes | — | No |
| `Initial_Centroids` | TEXT | Yes | — | No |

Indexes:
- `idx_baseline_customer`: non-unique on `CustomerID`; origin `c`; partial=False.

Declared foreign keys:
- None.

## Method-specific schema notes

- `Time_Cycle_0_Segmentation` stores `KMeans_Cluster_Number`, `Elbow_Inertia_Value`, hard-label Silhouette/DB/CH, and the selected K-means centroids. It does not store Cycle 0 fuzzy objective or Xie–Beni values.
- `MDFCM_Candidate_Evaluations` stores the dynamic candidate operation, candidate score, FCM objective, convergence, final membership change, final objective change, and tolerance for Cycles 1–9.
- `Dynamic_Loop_Results` and related cycle summaries store actual fuzzy memberships for the dynamic cycles. Cycle 0 vectors are one-hot K-means assignments for shared history rendering.
- Customer-to-cycle, cycle-to-centroid, and summary relationships are application-level joins unless a listed index says otherwise.
