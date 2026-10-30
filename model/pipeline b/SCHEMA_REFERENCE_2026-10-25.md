# Current SQLite schema — 25 October 2026

Current reporting database: `model/pipeline b/repair_outputs_2026-10-23/named_20261025_214151/csrs_pipeline_b_repaired.db`.

22 tables. Reporting names and per-cluster diagnostic columns are included. Inferred customer/cycle joins are not declared foreign keys.

## Cluster_Lineage

Rows: 285

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| PreviousLocalCluster | REAL | False | False |
| CurrentLocalCluster | REAL | False | False |
| PreviousStableClusterID | TEXT | False | False |
| CurrentStableClusterID | TEXT | False | False |
| CentroidDistance | REAL | False | False |
| CustomerOverlapJaccard | REAL | False | False |
| MatchCost | REAL | False | False |
| LineageEvent | TEXT | False | False |
| IsPrimaryMatch | INTEGER | False | False |

Indexes: none.

## Current_Cluster_Profiles

Rows: 61

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| cycleNumber | INTEGER | False | False |
| localIndex | INTEGER | False | False |
| stableClusterId | TEXT | False | False |
| businessProfile | TEXT | False | False |
| displayLabel | TEXT | False | False |
| labelOrder | INTEGER | False | False |
| labelRationale | TEXT | False | False |
| storedBusinessProfile | TEXT | False | False |
| PC1 | REAL | False | False |
| PC2 | REAL | False | False |
| PC3 | REAL | False | False |
| hardWinnerCustomers | INTEGER | False | False |
| fuzzyMembershipMass | REAL | False | False |
| weightedRecency | REAL | False | False |
| weightedFrequency | REAL | False | False |
| weightedMonetary | REAL | False | False |
| retainedAssignedCustomers | INTEGER | False | False |
| isSoftOnly | INTEGER | False | False |
| fitCustomers | INTEGER | False | False |
| fittedK | INTEGER | False | False |
| occupiedK | INTEGER | False | False |
| hardMeanRecency | REAL | False | False |
| hardMeanFrequency | REAL | False | False |
| hardMeanMonetary | REAL | False | False |
| winnerMeanMembership | REAL | False | False |
| fuzzyWeightMass | REAL | False | False |
| fitMethod | TEXT | False | False |
| coordinateSource | TEXT | False | False |
| meanSilhouette | REAL | False | False |
| negativeSilhouetteShare | REAL | False | False |
| meanMaximumMembership | REAL | False | False |
| hardWithinSumSquares | REAL | False | False |
| fuzzyObjectiveContribution | REAL | False | False |
| meanCentreDistance | REAL | False | False |
| p95CentreDistance | REAL | False | False |
| maxCentreDistance | REAL | False | False |
| description | TEXT | False | False |

Indexes: idx_current_cluster_display (unique), idx_current_cluster_cycle_id (unique), idx_current_cluster_cycle_local (unique).

## Current_Model_Quality

Rows: 10

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| cycleNumber | INTEGER | False | False |
| fitMethod | TEXT | False | False |
| ModelFitCustomers | INTEGER | False | False |
| SelectedK | INTEGER | False | False |
| OccupiedK | INTEGER | False | False |
| SoftOnlyCentres | INTEGER | False | False |
| SilhouetteScore | REAL | False | False |
| DaviesBouldinScore | REAL | False | False |
| CalinskiHarabaszScore | REAL | False | False |
| Inertia | REAL | False | False |
| FuzzyObjective | REAL | False | False |
| XieBeniIndex | REAL | False | False |
| AverageMembership | REAL | False | False |
| MembershipFloor | REAL | False | False |
| Fuzziness | REAL | False | False |
| Converged | REAL | False | False |
| Iterations | REAL | False | False |
| SelectedOperation | TEXT | False | False |
| MetricScope | TEXT | False | False |
| UnavailableHardMetricReason | TEXT | False | False |

Indexes: idx_current_quality_cycle (unique).

## Customer

Rows: 4297

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CustomerID | INTEGER | False | False |
| Country | TEXT | False | False |
| FirstPurchaseDate | TEXT | False | False |
| LastPurchaseDate | TEXT | False | False |

Indexes: idx_customer_id (unique).

## Customer_Transitions

Rows: 28598

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CustomerID | INTEGER | False | False |
| CycleID | TEXT | False | False |
| PreviousCycleID | TEXT | False | False |
| CurrentCycleID | TEXT | False | False |
| Cluster_Local_Index | INTEGER | False | False |
| MDFCM_Cluster_Number | INTEGER | False | False |
| Stable_Cluster_ID | TEXT | False | False |
| Previous_Stable_Cluster_ID | TEXT | False | False |
| Model_Profile_Name | TEXT | False | False |
| Segment_Name | TEXT | False | False |
| Previous_Segment_Name | TEXT | False | False |
| Previous_Cluster_Local_Index | REAL | False | False |
| Previous_Activity_Status | TEXT | False | False |
| Activity_Status | TEXT | False | False |
| Assignment_Mode | TEXT | False | False |
| Transition_Status | TEXT | False | False |
| Migration_Status | TEXT | False | False |
| Highest_Membership_Score | REAL | False | False |
| Fuzzy_Membership_Details | TEXT | False | False |
| Previous_Centroid_Assigned_Stable_ID | TEXT | False | False |
| Feature_Displacement | REAL | False | False |
| Migration_Cause | TEXT | False | False |

Indexes: idx_transition_cycle_status.

## Cycle_0_Elbow_Results

Rows: 9

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| K | INTEGER | False | False |
| Inertia | REAL | False | False |
| Within_Cluster_Sum_of_Squares | REAL | False | False |
| Silhouette_Score | REAL | False | False |
| Normalized_K | REAL | False | False |
| Normalized_Inertia | REAL | False | False |
| Elbow_Distance | REAL | False | False |
| Selected_K | REAL | False | False |

Indexes: none.

## Cycle_Definitions

Rows: 10

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| CycleNumber | INTEGER | False | False |
| PeriodStart | TEXT | False | False |
| PeriodEnd | TEXT | False | False |
| WindowStart | TEXT | False | False |
| SnapshotDate | TEXT | False | False |
| Phase | TEXT | False | False |

Indexes: idx_cycle_definition (unique).

## Data_Preprocessing_Results

Rows: 30280

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| PreprocessID | INTEGER | False | False |
| CustomerID | INTEGER | False | False |
| CycleID | TEXT | False | False |
| Cycle_End_Date | TEXT | False | False |
| Window_Start_Date | TEXT | False | False |
| Frequency_Monetary_Period_Start | TEXT | False | False |
| Frequency_Monetary_Period_End | TEXT | False | False |
| Frequency_Monetary_Period_Months | INTEGER | False | False |
| FirstPurchaseDate | TEXT | False | False |
| LatestPurchaseDate | TEXT | False | False |
| Activity_Status | TEXT | False | False |
| Lifecycle_Status | TEXT | False | False |
| Model_Profile_Name | TEXT | False | False |
| Is_New | INTEGER | False | False |
| Recency | INTEGER | False | False |
| Has_Purchase_In_Recency_Window | INTEGER | False | False |
| Frequency | REAL | False | False |
| Monetary | REAL | False | False |
| Products | REAL | False | False |
| Quantity | REAL | False | False |
| Recency_Bucket | TEXT | False | False |
| Risk_Status | TEXT | False | False |
| Risk_Reasons | TEXT | False | False |
| Membership_Change | REAL | False | False |
| Frequency_Change_Ratio | REAL | False | False |
| Monetary_Change_Ratio | REAL | False | False |
| Is_Model_Fit | INTEGER | False | False |
| Current_Period_Orders | REAL | False | False |
| Current_Period_Revenue | REAL | False | False |
| Current_Period_Products | REAL | False | False |
| Current_Period_Quantity | REAL | False | False |
| Log_R | REAL | False | False |
| Log_F | REAL | False | False |
| Log_M | REAL | False | False |
| RF_Score | REAL | False | False |
| RM_Score | REAL | False | False |
| FM_Score | REAL | False | False |
| Scaled_Log_R | REAL | False | False |
| Scaled_Log_F | REAL | False | False |
| Scaled_Log_M | REAL | False | False |
| Scaled_RF_Score | REAL | False | False |
| Scaled_RM_Score | REAL | False | False |
| Scaled_FM_Score | REAL | False | False |
| PC1 | REAL | False | False |
| PC2 | REAL | False | False |
| PC3 | REAL | False | False |

Indexes: idx_preprocessing_customer_cycle.

## Dynamic_Business_Analytics

Rows: 309302

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| InvoiceNo | TEXT | False | False |
| StockCode | TEXT | False | False |
| Description | TEXT | False | False |
| Quantity | INTEGER | False | False |
| InvoiceDate | TEXT | False | False |
| UnitPrice | REAL | False | False |
| CustomerID | INTEGER | False | False |
| Country | TEXT | False | False |
| Stable_Cluster_ID | TEXT | False | False |
| Total_Price | REAL | False | False |
| CycleID | TEXT | False | False |
| Revenue | REAL | False | False |
| Segment_Name | TEXT | False | False |

Indexes: idx_business_cycle_country.

## Dynamic_Centroids

Rows: 56

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| ClusterID | INTEGER | False | False |
| PC1 | REAL | False | False |
| PC2 | REAL | False | False |
| PC3 | REAL | False | False |

Indexes: none.

## Dynamic_Customer_Summary

Rows: 28598

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| CustomerID | INTEGER | False | False |
| Cluster_Local_Index | INTEGER | False | False |
| Stable_Cluster_ID | TEXT | False | False |
| Segment_Name | TEXT | False | False |
| Activity_Status | TEXT | False | False |
| Assignment_Mode | TEXT | False | False |
| Orders | REAL | False | False |
| Products | REAL | False | False |
| Quantity | REAL | False | False |
| Revenue | REAL | False | False |
| Average_Membership | REAL | False | False |
| Migration_Status | TEXT | False | False |
| Transition_Status | TEXT | False | False |
| Average_Basket_Value | REAL | False | False |
| Risk_Status | TEXT | False | False |
| Risk_Reasons | TEXT | False | False |
| Membership_Change | REAL | False | False |
| Frequency_Change_Ratio | REAL | False | False |
| Monetary_Change_Ratio | REAL | False | False |
| Is_Model_Fit | INTEGER | False | False |
| Current_Period_Orders | REAL | False | False |
| Current_Period_Revenue | REAL | False | False |
| Current_Period_Products | REAL | False | False |
| Current_Period_Quantity | REAL | False | False |
| Is_At_Risk | INTEGER | False | False |

Indexes: idx_customer_summary_cycle.

## Dynamic_Cycle_Summary

Rows: 9

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| CustomersProcessed | INTEGER | False | False |
| ModelFitCustomers | INTEGER | False | False |
| RetainedInactiveCustomers | INTEGER | False | False |
| ActiveCustomers | INTEGER | False | False |
| InactiveCustomers | INTEGER | False | False |
| NewCustomers | INTEGER | False | False |
| ReactivatedCustomers | INTEGER | False | False |
| HistoricalMembershipMassUsed | REAL | False | False |
| InputSnapshotPolicy | TEXT | False | False |
| StableCustomers | INTEGER | False | False |
| MigratedCustomers | INTEGER | False | False |
| ComparableCustomers | INTEGER | False | False |
| MigrationRate | REAL | False | False |
| CentroidShift | REAL | False | False |
| Iterations | INTEGER | False | False |
| SelectedK | INTEGER | False | False |
| Condition1Met | INTEGER | False | False |
| Condition2Met | INTEGER | False | False |
| Condition1ObservationCount | INTEGER | False | False |
| Condition2ObservationCount | INTEGER | False | False |
| MDFCMDecision | TEXT | False | False |
| SelectedOperation | TEXT | False | False |
| SelectedSourceLocalClusters | TEXT | False | False |
| SelectedSourceStableClusterIDs | TEXT | False | False |
| SelectedResultLocalClusters | TEXT | False | False |
| SelectedResultStableClusterIDs | TEXT | False | False |
| CandidateXB | TEXT | False | False |
| MDFCMAlpha | REAL | False | False |
| Fuzziness | REAL | False | False |
| ConvergenceTolerance | REAL | False | False |
| ConvergenceCriterion | TEXT | False | False |
| SilhouetteScore | REAL | False | False |
| DaviesBouldinScore | REAL | False | False |
| CalinskiHarabaszScore | REAL | False | False |
| XieBeniIndex | REAL | False | False |
| FuzzyObjective | REAL | False | False |
| AverageMembership | REAL | False | False |
| NetGrossMonetaryRankCorrelation | REAL | False | False |
| MonetaryRankQuartileChangedCustomers | REAL | False | False |
| MonetaryRankQuartileChangedShare | REAL | False | False |
| ProcessingTime | REAL | False | False |
| ProcessingDate | TEXT | False | False |
| Converged | INTEGER | False | False |

Indexes: none.

## Dynamic_Loop_Results

Rows: 28598

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| DynamicID | INTEGER | False | False |
| CustomerID | INTEGER | False | False |
| CycleID | TEXT | False | False |
| PreviousCycleID | TEXT | False | False |
| CurrentCycleID | TEXT | False | False |
| Previous_Cluster_Local_Index | REAL | False | False |
| Previous_Stable_Cluster_ID | TEXT | False | False |
| Previous_Segment_Name | TEXT | False | False |
| MDFCM_Cluster_Number | INTEGER | False | False |
| Cluster_Local_Index | INTEGER | False | False |
| Stable_Cluster_ID | TEXT | False | False |
| Highest_Membership_Score | REAL | False | False |
| All_Fuzzy_Memberships | TEXT | False | False |
| Fuzzy_Membership_Details | TEXT | False | False |
| Migration_Status | TEXT | False | False |
| Transition_Status | TEXT | False | False |
| Previous_Activity_Status | TEXT | False | False |
| Activity_Status | TEXT | False | False |
| Lifecycle_Status | TEXT | False | False |
| Assignment_Mode | TEXT | False | False |
| Model_Profile_Name | TEXT | False | False |
| Segment_Name | TEXT | False | False |
| Risk_Status | TEXT | False | False |
| Risk_Reasons | TEXT | False | False |
| Membership_Change | REAL | False | False |
| Frequency_Change_Ratio | REAL | False | False |
| Monetary_Change_Ratio | REAL | False | False |
| Is_Model_Fit | INTEGER | False | False |
| Current_Period_Orders | REAL | False | False |
| Current_Period_Revenue | REAL | False | False |
| Current_Period_Products | REAL | False | False |
| Current_Period_Quantity | REAL | False | False |
| Updated_Centroids | TEXT | False | False |
| Dynamic_Silhouette_Score | REAL | False | False |
| Fuzzy_Objective | REAL | False | False |
| Xie_Beni_Index | REAL | False | False |
| MDFCM_Condition_1_Met | INTEGER | False | False |
| MDFCM_Condition_2_Met | INTEGER | False | False |
| MDFCM_Condition_1_Count | INTEGER | False | False |
| MDFCM_Condition_2_Count | INTEGER | False | False |
| MDFCM_Decision | TEXT | False | False |
| MDFCM_Selected_K | INTEGER | False | False |
| MDFCM_Candidate_XB | TEXT | False | False |
| MDFCM_Alpha | REAL | False | False |
| MDFCM_Fuzziness | REAL | False | False |
| MDFCM_Convergence_Tolerance | REAL | False | False |
| MDFCM_Convergence_Criterion | TEXT | False | False |

Indexes: idx_dynamic_customer_cycle.

## Dynamic_Product_Summary

Rows: 65404

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| Stable_Cluster_ID | TEXT | False | False |
| Segment_Name | TEXT | False | False |
| Description | TEXT | False | False |
| Quantity_Sold | INTEGER | False | False |
| Revenue | REAL | False | False |
| Customer_Count | INTEGER | False | False |
| Orders | INTEGER | False | False |
| Average_Price | REAL | False | False |

Indexes: idx_product_summary_cycle.

## Dynamic_Segment_Summary

Rows: 56

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| Stable_Cluster_ID | TEXT | False | False |
| Segment_Name | TEXT | False | False |
| Customers | INTEGER | False | False |
| Orders | REAL | False | False |
| Quantity | REAL | False | False |
| Revenue | REAL | False | False |
| Average_Membership | REAL | False | False |
| At_Risk_Customers | INTEGER | False | False |
| At_Risk_Share | REAL | False | False |
| Average_Order_Value | REAL | False | False |
| Revenue_Per_Customer | REAL | False | False |

Indexes: idx_segment_summary_cycle.

## Firmographic_Customer_Segmentation

Rows: 30280

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CustomerID | INTEGER | False | False |
| CycleID | TEXT | False | False |
| Segment_Name | TEXT | False | False |
| Activity_Status | TEXT | False | False |
| Highest_Membership_Score | REAL | False | False |
| Risk_Status | TEXT | False | False |
| Risk_Reasons | TEXT | False | False |
| Membership_Change | REAL | False | False |
| Frequency_Change_Ratio | REAL | False | False |
| Monetary_Change_Ratio | REAL | False | False |
| Is_Model_Fit | INTEGER | False | False |
| Current_Period_Orders | REAL | False | False |
| Current_Period_Revenue | REAL | False | False |
| Current_Period_Products | REAL | False | False |
| Current_Period_Quantity | REAL | False | False |
| Country | TEXT | False | False |
| Geographic_Cluster_Number | INTEGER | False | False |
| Geographic_Segment_Name | TEXT | False | False |
| Firmographic_Segment_Name | TEXT | False | False |

Indexes: idx_firmographic_cycle_customer.

## Geographic_Cycle_Summary

Rows: 10

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| Markets | INTEGER | False | False |
| SilhouetteScore | REAL | False | False |
| DaviesBouldinScore | REAL | False | False |
| CalinskiHarabaszScore | REAL | False | False |

Indexes: none.

## Geographic_Market_Features

Rows: 346

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| Country | TEXT | False | False |
| Revenue | REAL | False | False |
| Quantity | REAL | False | False |
| Active_Customer_Count | REAL | False | False |
| Orders | REAL | False | False |
| Product_Diversity | REAL | False | False |
| Repeat_Purchase_Rate | REAL | False | False |
| Customer_Count | INTEGER | False | False |
| Champions_Share | REAL | False | False |
| Loyalists_Share | REAL | False | False |
| Mid_Tier_Occasionals_Share | REAL | False | False |
| Developing_Share | REAL | False | False |
| Hibernating_Lost_Share | REAL | False | False |
| At_Risk_Share | REAL | False | False |
| Other_Customer_Segment_Share | REAL | False | False |
| Orders_Per_Customer | REAL | False | False |
| Revenue_Per_Customer | REAL | False | False |
| Log_Customer_Count | REAL | False | False |
| Log_Revenue | REAL | False | False |
| Log_Orders_Per_Customer | REAL | False | False |
| Log_Revenue_Per_Customer | REAL | False | False |
| Log_Product_Diversity | REAL | False | False |
| CycleID | TEXT | False | False |
| Cycle_End_Date | TEXT | False | False |
| Geographic_Cluster_Number | INTEGER | False | False |
| Geographic_Segment_Name | TEXT | False | False |
| Scaled_Log_Customer_Count | REAL | False | False |
| Scaled_Log_Revenue | REAL | False | False |
| Scaled_Log_Orders_Per_Customer | REAL | False | False |
| Scaled_Log_Revenue_Per_Customer | REAL | False | False |
| Scaled_Log_Product_Diversity | REAL | False | False |
| Scaled_Repeat_Purchase_Rate | REAL | False | False |
| Scaled_Champions_Share | REAL | False | False |
| Scaled_Loyalists_Share | REAL | False | False |
| Scaled_Mid_Tier_Occasionals_Share | REAL | False | False |
| Scaled_Developing_Share | REAL | False | False |
| Scaled_Hibernating_Lost_Share | REAL | False | False |
| Scaled_Other_Customer_Segment_Share | REAL | False | False |

Indexes: none.

## Geographic_Segmentation

Rows: 346

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| Country | TEXT | False | False |
| Geographic_Cluster_Number | INTEGER | False | False |
| Geographic_Segment_Name | TEXT | False | False |
| Customer_Count | INTEGER | False | False |
| Active_Customer_Count | REAL | False | False |
| Revenue | REAL | False | False |
| Orders | REAL | False | False |
| Product_Diversity | REAL | False | False |
| Orders_Per_Customer | REAL | False | False |
| Revenue_Per_Customer | REAL | False | False |
| Repeat_Purchase_Rate | REAL | False | False |
| Champions_Share | REAL | False | False |
| Loyalists_Share | REAL | False | False |
| Mid_Tier_Occasionals_Share | REAL | False | False |
| Developing_Share | REAL | False | False |
| Hibernating_Lost_Share | REAL | False | False |
| At_Risk_Share | REAL | False | False |

Indexes: idx_geo_cycle_country.

## MDFCM_Candidate_Evaluations

Rows: 18

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| CycleID | TEXT | False | False |
| PreviousK | INTEGER | False | False |
| CandidateK | INTEGER | False | False |
| InitializationAction | TEXT | False | False |
| SourceLocalClusters | TEXT | False | False |
| SourceStableClusterIDs | TEXT | False | False |
| ResultLocalClusters | TEXT | False | False |
| ResultStableClusterIDs | TEXT | False | False |
| XieBeniIndex | REAL | False | False |
| FuzzyObjective | REAL | False | False |
| Iterations | INTEGER | False | False |
| Converged | INTEGER | False | False |
| FinalMembershipChange | REAL | False | False |
| FinalObjectiveChange | REAL | False | False |
| ConvergenceTolerance | REAL | False | False |
| Selected | INTEGER | False | False |

Indexes: none.

## Model_Metadata

Rows: 23

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| MetadataKey | TEXT | False | False |
| MetadataValue | TEXT | False | False |

Indexes: none.

## Time_Cycle_0_Segmentation

Rows: 1682

| Column | Type | Not null | Primary key |
| --- | --- | --- | --- |
| Cycle0_ID | INTEGER | False | False |
| CustomerID | INTEGER | False | False |
| Cluster_Local_Index | INTEGER | False | False |
| Stable_Cluster_ID | TEXT | False | False |
| KMeans_Cluster_Number | INTEGER | False | False |
| Model_Profile_Name | TEXT | False | False |
| Segment_Name | TEXT | False | False |
| Risk_Status | TEXT | False | False |
| Risk_Reasons | TEXT | False | False |
| Membership_Change | REAL | False | False |
| Frequency_Change_Ratio | REAL | False | False |
| Monetary_Change_Ratio | REAL | False | False |
| Is_Model_Fit | INTEGER | False | False |
| Current_Period_Orders | INTEGER | False | False |
| Current_Period_Revenue | REAL | False | False |
| Current_Period_Products | INTEGER | False | False |
| Current_Period_Quantity | INTEGER | False | False |
| Recency | INTEGER | False | False |
| Frequency | REAL | False | False |
| Monetary | REAL | False | False |
| All_Fuzzy_Memberships | TEXT | False | False |
| Fuzzy_Membership_Details | TEXT | False | False |
| PC1 | REAL | False | False |
| PC2 | REAL | False | False |
| PC3 | REAL | False | False |
| Optimal_K_Value | INTEGER | False | False |
| Elbow_Inertia_Value | REAL | False | False |
| Silhouette_Score | REAL | False | False |
| Davies_Bouldin_Score | REAL | False | False |
| Calinski_Harabasz_Score | REAL | False | False |
| Initial_Centroids | TEXT | False | False |

Indexes: idx_baseline_customer.
