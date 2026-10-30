from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import matplotlib
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import (
    calinski_harabasz_score,
    davies_bouldin_score,
    silhouette_score,
)
from sklearn.preprocessing import MinMaxScaler, RobustScaler

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns


RANDOM_STATE = 42
GEOGRAPHIC_SEGMENTS = {
    0: "Largest Revenue Market",
    1: "Highest Revenue-per-Customer Market",
    2: "Other Markets",
}
FEATURE_COLUMNS = [
    "Log_R",
    "Log_F",
    "Log_M",
    "RF_Score",
    "RM_Score",
    "FM_Score",
]
SCALED_FEATURE_COLUMNS = [
    "Scaled_Log_R",
    "Scaled_Log_F",
    "Scaled_Log_M",
    "Scaled_RF_Score",
    "Scaled_RM_Score",
    "Scaled_FM_Score",
]
PCA_COLUMNS = ["PC1", "PC2", "PC3"]
MIN_LINEAGE_JACCARD = 0.05
from cluster_labels import (
    assign_cluster_names, PROFILE_ORDER, PROFILE_COLORS, LABEL_POLICY,
    base_profile, profile_color, profile_sort_key,
)

GEOGRAPHIC_FEATURE_COLUMNS = [
    "Log_Customer_Count",
    "Log_Revenue",
    "Log_Orders_Per_Customer",
    "Log_Revenue_Per_Customer",
    "Log_Product_Diversity",
    "Repeat_Purchase_Rate",
    "Champions_Share",
    "Loyalists_Share",
    "Mid_Tier_Occasionals_Share",
    "Developing_Share",
    "Hibernating_Lost_Share",
    "Other_Customer_Segment_Share",
]


@dataclass(frozen=True)
class CycleDefinition:
    cycle_number: int
    cycle_id: str
    period_start: pd.Timestamp
    period_end: pd.Timestamp
    window_start: pd.Timestamp
    snapshot_date: pd.Timestamp
    phase: str


@dataclass
class PipelineArtifacts:
    transactions: pd.DataFrame
    customer_master: pd.DataFrame
    cycle_definitions: list[CycleDefinition]
    preprocessing: pd.DataFrame
    baseline_segmentation: pd.DataFrame
    elbow_results: pd.DataFrame
    dynamic_results: pd.DataFrame
    customer_transitions: pd.DataFrame
    cycle_summary: pd.DataFrame
    mdfcm_candidate_evaluations: pd.DataFrame
    centroids: pd.DataFrame
    cluster_lineage: pd.DataFrame
    customer_summary: pd.DataFrame
    segment_summary: pd.DataFrame
    product_summary: pd.DataFrame
    business_analytics: pd.DataFrame
    geographic_features: pd.DataFrame
    geographic_segmentation: pd.DataFrame
    geographic_cycle_summary: pd.DataFrame
    firmographic_segmentation: pd.DataFrame
    scaler: MinMaxScaler
    pca: PCA
    baseline_kmeans: KMeans
    geographic_scaler: RobustScaler
    geographic_kmeans: KMeans
    behavioural_cluster_mapping: dict[int, int]
    geographic_cluster_mapping: dict[int, int]


def load_transactions(
    source_path: Path,
    deduplicate_exact_rows: bool = True,
) -> pd.DataFrame:
    transactions = pd.read_excel(source_path)
    required = {
        "InvoiceNo",
        "StockCode",
        "Description",
        "Quantity",
        "InvoiceDate",
        "UnitPrice",
        "CustomerID",
        "Country",
    }
    missing = sorted(required.difference(transactions.columns))
    if missing:
        raise ValueError(f"Missing required transaction columns: {missing}")

    transactions = transactions.copy()
    if deduplicate_exact_rows:
        transactions = transactions.drop_duplicates(subset=sorted(required), keep="first")
    transactions["InvoiceNo"] = (
        transactions["InvoiceNo"].where(transactions["InvoiceNo"].notna(), "")
        .astype(str)
        .str.strip()
    )
    transactions["StockCode"] = transactions["StockCode"].astype(str).str.strip()
    transactions["Description"] = (
        transactions["Description"].fillna("Unknown product").astype(str).str.strip()
    )
    transactions["Country"] = (
        transactions["Country"].fillna("Unspecified").astype(str).str.strip()
    )
    transactions["InvoiceDate"] = pd.to_datetime(transactions["InvoiceDate"], errors="coerce")
    transactions["Quantity"] = pd.to_numeric(transactions["Quantity"], errors="coerce")
    transactions["UnitPrice"] = pd.to_numeric(transactions["UnitPrice"], errors="coerce")
    transactions["CustomerID"] = pd.to_numeric(transactions["CustomerID"], errors="coerce")
    transactions["_SourceOrder"] = np.arange(len(transactions), dtype="int64")

    customer_ids = transactions["CustomerID"].to_numpy(dtype=float)
    valid_customer_id = (
        np.isfinite(customer_ids)
        & (customer_ids == np.floor(customer_ids))
        & (customer_ids >= float(np.iinfo(np.int64).min))
        & (customer_ids < float(2**63))
    )

    transactions = transactions.loc[
        valid_customer_id
        & transactions["InvoiceNo"].ne("").to_numpy()
        & transactions["InvoiceDate"].notna()
        & transactions["InvoiceDate"].ge(pd.Timestamp("2010-12-01"))
        & transactions["InvoiceDate"].lt(pd.Timestamp("2011-12-01"))
        & np.isfinite(transactions["UnitPrice"].to_numpy(dtype=float))
        & transactions["UnitPrice"].gt(0)
        & np.isfinite(transactions["Quantity"].to_numpy(dtype=float))
        & transactions["Quantity"].gt(0)
    ].copy()
    transactions["CustomerID"] = transactions["CustomerID"].astype("int64")
    is_cancellation = transactions["InvoiceNo"].str.upper().str.startswith("C")
    events = transactions.loc[~is_cancellation].sort_values(
        ["InvoiceDate", "_SourceOrder"], kind="stable"
    ).copy()
    events["Source_Quantity"] = events["Quantity"].astype(float)
    events["Total_Price"] = events["Quantity"] * events["UnitPrice"]
    events["Purchase_InvoiceNo"] = events["InvoiceNo"].where(events["Quantity"].gt(0))
    events["Transaction_Type"] = "Paid purchase"
    return events.sort_values(["InvoiceDate", "_SourceOrder"], kind="stable").drop(
        columns="_SourceOrder"
    ).reset_index(drop=True)


def build_cycle_definitions(transactions: pd.DataFrame) -> list[CycleDefinition]:
    minimum_date = transactions["InvoiceDate"].min().normalize()
    maximum_date = transactions["InvoiceDate"].max().normalize()
    baseline_start = pd.Timestamp("2010-12-01")
    baseline_snapshot = pd.Timestamp("2011-03-01")
    if minimum_date > baseline_start or maximum_date < pd.Timestamp("2011-11-30"):
        raise ValueError("The transaction date range does not support the planned cycle structure")

    definitions = [
        CycleDefinition(
            cycle_number=0,
            cycle_id="Cycle_0",
            period_start=baseline_start,
            period_end=baseline_snapshot,
            window_start=baseline_start,
            snapshot_date=baseline_snapshot,
            phase="Baseline",
        )
    ]
    month_starts = pd.date_range("2011-03-01", "2011-11-01", freq="MS")
    for cycle_number, period_start in enumerate(month_starts, start=1):
        period_end = period_start + pd.offsets.MonthBegin(1)
        snapshot_date = period_end
        window_start = snapshot_date - pd.Timedelta(days=90)
        definitions.append(
            CycleDefinition(
                cycle_number=cycle_number,
                cycle_id=f"Cycle_{cycle_number}",
                period_start=pd.Timestamp(period_start),
                period_end=pd.Timestamp(period_end),
                window_start=pd.Timestamp(window_start),
                snapshot_date=pd.Timestamp(snapshot_date),
                phase="Dynamic update",
            )
        )
    return definitions


def build_customer_master(transactions: pd.DataFrame) -> pd.DataFrame:
    purchases = transactions.loc[transactions["Purchase_InvoiceNo"].notna()]
    first_purchase = purchases.groupby("CustomerID")["InvoiceDate"].min()
    last_purchase = purchases.groupby("CustomerID")["InvoiceDate"].max()
    country_counts = (
        purchases.groupby(["CustomerID", "Country"])
        .size()
        .rename("Transaction_Count")
        .reset_index()
        .sort_values(["CustomerID", "Transaction_Count", "Country"], ascending=[True, False, True])
    )
    primary_country = country_counts.drop_duplicates("CustomerID").set_index("CustomerID")["Country"]
    customer_master = pd.DataFrame(
        {
            "CustomerID": first_purchase.index.astype("int64"),
            "Country": primary_country.reindex(first_purchase.index).fillna("Unspecified").to_numpy(),
            "FirstPurchaseDate": first_purchase.to_numpy(),
            "LastPurchaseDate": last_purchase.reindex(first_purchase.index).to_numpy(),
        }
    )
    return customer_master.sort_values("CustomerID").reset_index(drop=True)


def build_behavioural_snapshot(
    transactions: pd.DataFrame,
    customer_master: pd.DataFrame,
    cycle: CycleDefinition,
) -> pd.DataFrame:
    """One current observation per known customer, using a consistent trailing 90-day window."""
    history = transactions.loc[transactions["InvoiceDate"].lt(cycle.snapshot_date)]
    purchases = history.loc[history["Purchase_InvoiceNo"].notna()]
    window_start = cycle.snapshot_date - pd.Timedelta(days=90)
    window = purchases.loc[purchases["InvoiceDate"].ge(window_start)]
    period = purchases.loc[purchases["InvoiceDate"].ge(cycle.period_start)]
    eligible = customer_master.loc[customer_master["FirstPurchaseDate"].lt(cycle.snapshot_date)]
    snapshot = eligible.set_index("CustomerID").copy()
    latest = purchases.groupby("CustomerID")["InvoiceDate"].max()
    snapshot["LatestPurchaseDate"] = latest.reindex(snapshot.index)
    rolling = window.groupby("CustomerID").agg(
        Frequency=("Purchase_InvoiceNo", "nunique"), Monetary=("Total_Price", "sum"),
        Products=("Description", "nunique"), Quantity=("Quantity", "sum"),
    ).reindex(snapshot.index).fillna(0.0)
    snapshot[["Frequency", "Monetary", "Products", "Quantity"]] = rolling.div(3.0)
    snapshot["Gross_Monetary"] = snapshot["Monetary"]
    commercial = period.groupby("CustomerID").agg(
        Current_Period_Orders=("Purchase_InvoiceNo", "nunique"),
        Current_Period_Revenue=("Total_Price", "sum"),
        Current_Period_Products=("Description", "nunique"),
        Current_Period_Quantity=("Quantity", "sum"),
    ).reindex(snapshot.index).fillna(0.0)
    snapshot[commercial.columns] = commercial
    snapshot["Recency"] = (cycle.snapshot_date.normalize() - snapshot["LatestPurchaseDate"].dt.normalize()).dt.days.astype("int64")
    snapshot["Has_Purchase_In_Recency_Window"] = snapshot["LatestPurchaseDate"].ge(window_start).astype("int64")
    snapshot["Lifecycle_Status"] = np.where(snapshot["Recency"].gt(90), "Hibernating / Lost", "Within 90-day window")
    snapshot["Activity_Status"] = np.where(snapshot["Current_Period_Orders"].gt(0), "Active", "Inactive")
    snapshot["Is_Model_Fit"] = 1
    snapshot["Is_New"] = (snapshot["FirstPurchaseDate"].ge(cycle.period_start) & snapshot["FirstPurchaseDate"].lt(cycle.period_end)).astype("int64")
    snapshot["Recency_Bucket"] = pd.cut(snapshot["Recency"], bins=[-1,30,60,90,np.inf], labels=["0-30 days","31-60 days","61-90 days","91+ days: hibernating/lost"]).astype(str)
    snapshot["Net_Monetary_Rank_Percentile"] = snapshot["Monetary"].rank(pct=True)
    snapshot["Gross_Monetary_Rank_Percentile"] = snapshot["Net_Monetary_Rank_Percentile"]
    snapshot["Monetary_Rank_Quartile_Changed"] = 0
    snapshot["Net_Gross_Monetary_Rank_Correlation"] = 1.0
    snapshot["Log_R"] = np.log1p(snapshot["Recency"].clip(lower=0))
    snapshot["Log_F"] = np.log1p(snapshot["Frequency"].clip(lower=0))
    snapshot["Log_M"] = np.log1p(snapshot["Monetary"].clip(lower=0))
    snapshot["RF_Score"] = snapshot["Log_R"] * snapshot["Log_F"]
    snapshot["RM_Score"] = snapshot["Log_R"] * snapshot["Log_M"]
    snapshot["FM_Score"] = snapshot["Log_F"] * snapshot["Log_M"]
    snapshot["CycleID"] = cycle.cycle_id
    snapshot["Cycle_End_Date"] = cycle.snapshot_date
    snapshot["Window_Start_Date"] = window_start
    snapshot["Frequency_Monetary_Period_Start"] = window_start
    snapshot["Frequency_Monetary_Period_End"] = cycle.snapshot_date
    snapshot["Frequency_Monetary_Period_Months"] = 3
    return snapshot.reset_index()


def transform_snapshot(
    snapshot: pd.DataFrame,
    scaler: MinMaxScaler,
    pca: PCA,
) -> pd.DataFrame:
    transformed = snapshot.copy()
    scaled = scaler.transform(transformed[FEATURE_COLUMNS])
    transformed[SCALED_FEATURE_COLUMNS] = scaled
    transformed[PCA_COLUMNS] = pca.transform(scaled)
    return transformed


def safe_cluster_metrics(features: np.ndarray, labels: np.ndarray) -> dict[str, float]:
    unique_labels = np.unique(labels)
    if len(unique_labels) < 2 or len(unique_labels) >= len(features):
        return {"silhouette": np.nan, "davies_bouldin": np.nan, "calinski_harabasz": np.nan}
    return {
        "silhouette": float(silhouette_score(features, labels)),
        "davies_bouldin": float(davies_bouldin_score(features, labels)),
        "calinski_harabasz": float(calinski_harabasz_score(features, labels)),
    }


def select_elbow_k(
    features: np.ndarray,
    minimum_k: int = 2,
    maximum_k: int = 10,
) -> tuple[int, pd.DataFrame]:
    """Choose the maximum-distance elbow over a reproducible WCSS curve."""
    upper_k = min(maximum_k, len(features) - 1)
    if upper_k < minimum_k:
        raise ValueError("Not enough Cycle 0 customers to evaluate the requested K range")
    rows: list[dict[str, float | int]] = []
    for k in range(minimum_k, upper_k + 1):
        candidate = KMeans(n_clusters=k, n_init=30, random_state=RANDOM_STATE)
        labels = candidate.fit_predict(features)
        rows.append({
            "K": k,
            "Inertia": float(candidate.inertia_),
            "Within_Cluster_Sum_of_Squares": float(candidate.inertia_),
            "Silhouette_Score": float(silhouette_score(features, labels)),
        })
    curve = pd.DataFrame(rows)
    x = curve["K"].to_numpy(dtype=float)
    y = curve["Inertia"].to_numpy(dtype=float)
    x_scaled = (x - x.min()) / max(x.max() - x.min(), 1.0)
    y_scaled = (y - y.min()) / max(y.max() - y.min(), 1e-12)
    distance_from_endpoint_line = (1.0 - x_scaled) - y_scaled
    selected_position = int(np.argmax(distance_from_endpoint_line))
    curve["Normalized_K"] = x_scaled
    curve["Normalized_Inertia"] = y_scaled
    curve["Elbow_Distance"] = distance_from_endpoint_line
    curve["Selected_K"] = x[selected_position]
    return int(x[selected_position]), curve


def order_baseline_clusters(
    snapshot: pd.DataFrame,
    raw_labels: np.ndarray,
) -> tuple[dict[int, int], pd.DataFrame]:
    profile = snapshot.assign(Raw_Cluster=raw_labels).groupby("Raw_Cluster").agg(
        Customers=("CustomerID", "size"),
        Average_Recency=("Recency", "mean"),
        Average_Frequency=("Frequency", "mean"),
        Average_Monetary=("Monetary", "mean"),
    )
    ordered_raw = profile.sort_values(
        ["Average_Monetary", "Average_Frequency", "Average_Recency"],
        ascending=[False, False, True],
    ).index.tolist()
    mapping = {int(raw_cluster): canonical for canonical, raw_cluster in enumerate(ordered_raw)}
    profile["Canonical_Cluster"] = [mapping[int(raw)] for raw in profile.index]
    return mapping, profile.reset_index()


def name_rfm_clusters(snapshot, labels, cluster_count=None, fuzzy_memberships=None, centroids=None):
    if centroids is None and cluster_count is not None:
        centroids = np.zeros((cluster_count, 3))
    return assign_cluster_names(snapshot, labels, centroids=centroids, fuzzy_memberships=fuzzy_memberships)


def match_cluster_ids(
    previous_centroids: np.ndarray,
    previous_state: pd.DataFrame,
    current_centroids: np.ndarray,
    current_customer_ids: pd.Series,
    current_labels: np.ndarray,
    next_cluster_number: int,
    cycle_id: str,
    current_memberships: np.ndarray | None = None,
    previous_stable_id_by_local: dict[int, str] | None = None,
) -> tuple[dict[int, str], int, pd.DataFrame]:
    """Assign tracking IDs from centre distance and cross-cycle customer memberships.

    The one-to-one assignment includes dummy unmatched choices. A continuation
    requires at least MIN_LINEAGE_JACCARD membership overlap and must cost less
    than separately retiring and creating the cluster. IDs remain provisional.
    """
    previous_k, current_k = len(previous_centroids), len(current_centroids)
    distances = np.sqrt(
        np.sum((previous_centroids[:, None, :] - current_centroids[None, :, :]) ** 2, axis=2)
    )
    positive_distances = distances[distances > 1e-12]
    distance_scale = float(np.median(positive_distances)) if len(positive_distances) else 1.0
    normalized_distances = distances / max(distance_scale, 1e-12)

    current_memberships = (
        None if current_memberships is None else np.asarray(current_memberships, dtype=float)
    )
    if current_memberships is not None and current_memberships.shape != (
        len(current_customer_ids), current_k
    ):
        raise ValueError("Current fuzzy memberships do not match tracking customers and centres")

    previous_fit_state = previous_state
    if "Activity_Status" in previous_state.columns:
        previous_fit_state = previous_state.loc[previous_state["Activity_Status"].eq("Active")]
    previous_ids = previous_stable_id_by_local or (
        previous_fit_state.drop_duplicates("Cluster_Local_Index")
        .set_index("Cluster_Local_Index")["Stable_Cluster_ID"]
        .to_dict()
    )
    overlap = np.zeros((previous_k, current_k), dtype=float)
    if current_memberships is not None and not previous_state.empty:
        stable_to_local = {stable_id: int(index) for index, stable_id in previous_ids.items()}
        prior_by_customer = previous_state.drop_duplicates("CustomerID").set_index("CustomerID")
        shared_positions = [
            (position, prior_by_customer.loc[customer_id])
            for position, customer_id in enumerate(current_customer_ids.to_numpy())
            if customer_id in prior_by_customer.index
        ]
        if shared_positions:
            old_memberships = np.zeros((len(shared_positions), previous_k), dtype=float)
            new_memberships = np.zeros((len(shared_positions), current_k), dtype=float)
            for shared_index, (current_position, prior_row) in enumerate(shared_positions):
                new_memberships[shared_index] = current_memberships[current_position]
                raw_details = prior_row.get("Fuzzy_Membership_Details")
                try:
                    details = json.loads(raw_details) if raw_details else []
                except (TypeError, json.JSONDecodeError):
                    details = []
                membership_by_id: dict[str, float] = {}
                for detail in details:
                    stable_id = str(detail.get("stable_cluster_id", ""))
                    if stable_id in stable_to_local:
                        try:
                            membership_by_id[stable_id] = max(
                                0.0, float(detail.get("membership", 0.0))
                            )
                        except (TypeError, ValueError):
                            continue
                for stable_id, previous_index in stable_to_local.items():
                    if 0 <= previous_index < previous_k:
                        old_memberships[shared_index, previous_index] = membership_by_id.get(
                            stable_id, 0.0
                        )
            for previous_index in range(previous_k):
                for current_index in range(current_k):
                    intersection = float(np.minimum(
                        old_memberships[:, previous_index],
                        new_memberships[:, current_index],
                    ).sum())
                    union = float(np.maximum(
                        old_memberships[:, previous_index],
                        new_memberships[:, current_index],
                    ).sum())
                    overlap[previous_index, current_index] = (
                        intersection / union if union > 1e-12 else 0.0
                    )
    else:
        # Compatibility fallback for callers without full fuzzy vectors.
        current = pd.DataFrame(
            {"CustomerID": current_customer_ids.to_numpy(), "CurrentLocalCluster": current_labels}
        )
        shared = previous_fit_state[
            ["CustomerID", "Cluster_Local_Index", "Stable_Cluster_ID"]
        ].merge(current, on="CustomerID", how="inner")
        if not shared.empty:
            counts = pd.crosstab(shared["Cluster_Local_Index"], shared["CurrentLocalCluster"])
            previous_sizes = shared.groupby("Cluster_Local_Index").size().reindex(
                range(previous_k), fill_value=0
            ).to_numpy(dtype=float)
            current_sizes = shared.groupby("CurrentLocalCluster").size().reindex(
                range(current_k), fill_value=0
            ).to_numpy(dtype=float)
            for previous_index in range(previous_k):
                for current_index in range(current_k):
                    intersection = float(
                        counts.get(current_index, pd.Series(dtype=float)).get(previous_index, 0)
                    )
                    union = previous_sizes[previous_index] + current_sizes[current_index] - intersection
                    overlap[previous_index, current_index] = intersection / union if union > 0 else 0.0
    cost = 0.5 * normalized_distances + 0.5 * (1.0 - overlap)
    # Add dummy nodes so the tracker can leave a weak pair unmatched instead of
    # forcing an identity link. A real pair must have at least the same overlap
    # threshold used for secondary lineage evidence, and cost less than one
    # retirement plus one creation (0.5 + 0.5).
    assignment_size = previous_k + current_k
    unmatched_cost = 0.5
    augmented_cost = np.zeros((assignment_size, assignment_size), dtype=float)
    pair_cost = np.where(overlap >= MIN_LINEAGE_JACCARD, cost, 1e9)
    augmented_cost[:previous_k, :current_k] = pair_cost
    augmented_cost[:previous_k, current_k:] = unmatched_cost
    augmented_cost[previous_k:, :current_k] = unmatched_cost
    matched_rows, matched_columns = linear_sum_assignment(augmented_cost)
    accepted_pairs = [
        (int(previous_index), int(current_index))
        for previous_index, current_index in zip(matched_rows, matched_columns)
        if previous_index < previous_k
        and current_index < current_k
        and augmented_cost[previous_index, current_index] < (2 * unmatched_cost)
    ]
    stable_by_current: dict[int, str] = {}
    primary_pairs: dict[int, int] = {}
    for previous_index, current_index in accepted_pairs:
        stable_by_current[current_index] = str(previous_ids[previous_index])
        primary_pairs[current_index] = previous_index
    for current_index in range(current_k):
        if current_index not in stable_by_current:
            stable_by_current[current_index] = f"CL-{next_cluster_number:03d}"
            next_cluster_number += 1

    previous_overlap_degree = (overlap >= 0.05).sum(axis=1)
    current_overlap_degree = (overlap >= 0.05).sum(axis=0)
    lineage: list[dict[str, Any]] = []
    matched_prev_set = {previous_index for previous_index, _ in accepted_pairs}
    matched_current_set = {current_index for _, current_index in accepted_pairs}
    for current_index, previous_index in primary_pairs.items():
        lineage.append({
            "CycleID": cycle_id,
            "PreviousLocalCluster": previous_index,
            "CurrentLocalCluster": current_index,
            "PreviousStableClusterID": previous_ids[previous_index],
            "CurrentStableClusterID": stable_by_current[current_index],
            "CentroidDistance": float(distances[previous_index, current_index]),
            "CustomerOverlapJaccard": float(overlap[previous_index, current_index]),
            "MatchCost": float(cost[previous_index, current_index]),
            "LineageEvent": "continued",
            "IsPrimaryMatch": 1,
        })
    for previous_index in range(previous_k):
        for current_index in range(current_k):
            if (previous_index, current_index) in set(accepted_pairs) or overlap[
                previous_index, current_index
            ] < MIN_LINEAGE_JACCARD:
                continue
            is_split_contribution = previous_overlap_degree[previous_index] > 1
            is_merge_contribution = current_overlap_degree[current_index] > 1
            if is_split_contribution and is_merge_contribution:
                event = "split/merge contribution"
            elif is_split_contribution:
                event = "split contribution"
            elif is_merge_contribution:
                event = "merge contribution"
            else:
                event = "secondary overlap"
            lineage.append({
                "CycleID": cycle_id,
                "PreviousLocalCluster": previous_index,
                "CurrentLocalCluster": current_index,
                "PreviousStableClusterID": previous_ids.get(previous_index),
                "CurrentStableClusterID": stable_by_current[current_index],
                "CentroidDistance": float(distances[previous_index, current_index]),
                "CustomerOverlapJaccard": float(overlap[previous_index, current_index]),
                "MatchCost": float(cost[previous_index, current_index]),
                "LineageEvent": event,
                "IsPrimaryMatch": 0,
            })
    for previous_index in range(previous_k):
        if previous_index not in matched_prev_set:
            lineage.append({
                "CycleID": cycle_id,
                "PreviousLocalCluster": previous_index,
                "CurrentLocalCluster": None,
                "PreviousStableClusterID": previous_ids.get(previous_index),
                "CurrentStableClusterID": None,
                "CentroidDistance": None,
                "CustomerOverlapJaccard": None,
                "MatchCost": None,
                "LineageEvent": "retired",
                "IsPrimaryMatch": 0,
            })
    for current_index in range(current_k):
        if current_index not in matched_current_set:
            lineage.append({
                "CycleID": cycle_id,
                "PreviousLocalCluster": None,
                "CurrentLocalCluster": current_index,
                "PreviousStableClusterID": None,
                "CurrentStableClusterID": stable_by_current[current_index],
                "CentroidDistance": None,
                "CustomerOverlapJaccard": None,
                "MatchCost": None,
                "LineageEvent": "created",
                "IsPrimaryMatch": 0,
            })
    return stable_by_current, next_cluster_number, pd.DataFrame(lineage)


def memberships_from_centroids(features: np.ndarray, centroids: np.ndarray, fuzziness: float) -> tuple[np.ndarray, np.ndarray]:
    if not np.isfinite(fuzziness) or fuzziness <= 1.0:
        raise ValueError("FCM fuzziness must be finite and greater than 1")
    if not np.isfinite(features).all() or not np.isfinite(centroids).all():
        raise ValueError("FCM features and centres must be finite")
    distance_squared = np.sum((features[:, None, :] - centroids[None, :, :]) ** 2, axis=2)
    zero_distance = distance_squared <= 1e-24
    distances = np.sqrt(np.maximum(distance_squared, 1e-24))
    exponent = 2.0 / (fuzziness - 1.0)
    relative_distances = distances / distances.min(axis=1, keepdims=True)
    inverse = np.power(relative_distances, -exponent)
    memberships = inverse / inverse.sum(axis=1, keepdims=True)
    exact_rows = np.where(zero_distance.any(axis=1))[0]
    if len(exact_rows):
        exact_centres = zero_distance[exact_rows].astype(float)
        memberships[exact_rows] = exact_centres / exact_centres.sum(axis=1, keepdims=True)
    return memberships, distance_squared


def fit_fuzzy_c_means(
    features: np.ndarray,
    cluster_count: int,
    fuzziness: float = 2.0,
    maximum_iterations: int = 300,
    objective_tolerance: float = 0.01,
    initial_centroids: np.ndarray | None = None,
    random_state: int = RANDOM_STATE,
) -> dict[str, Any]:
    """Fit standard FCM, stopping when the objective improvement is within E_FCM."""
    features = np.asarray(features, dtype=float)
    if features.ndim != 2 or features.shape[0] == 0 or features.shape[1] == 0:
        raise ValueError("FCM features must be a non-empty two-dimensional array")
    if not np.isfinite(features).all():
        raise ValueError("FCM features must be finite")
    if not np.isfinite(objective_tolerance) or objective_tolerance < 0:
        raise ValueError("FCM objective tolerance must be finite and non-negative")
    if maximum_iterations < 2:
        raise ValueError("FCM requires at least two iterations to check convergence")
    if not np.isfinite(fuzziness) or fuzziness <= 1.0:
        raise ValueError("FCM fuzziness must be finite and greater than 1")
    if cluster_count < 2 or cluster_count > len(features):
        raise ValueError("FCM requires 2 <= cluster_count <= observation count")

    if initial_centroids is None:
        rng = np.random.default_rng(random_state)
        memberships = rng.random((len(features), cluster_count))
        memberships /= memberships.sum(axis=1, keepdims=True)
        centers = np.empty((cluster_count, features.shape[1]), dtype=float)
    else:
        centers = np.asarray(initial_centroids, dtype=float).copy()
        if centers.shape != (cluster_count, features.shape[1]):
            raise ValueError("Initial FCM centres do not match the candidate dimensions")
        memberships, _ = memberships_from_centroids(features, centers, fuzziness)

    converged = False
    iterations = 0
    objective_change = np.inf
    previous_objective: float | None = None
    membership_change = np.inf
    for iterations in range(1, maximum_iterations + 1):
        weights = memberships**fuzziness
        centers = (weights.T @ features) / np.maximum(weights.sum(axis=0)[:, None], 1e-12)
        updated_memberships, distance_squared = memberships_from_centroids(
            features, centers, fuzziness
        )
        objective = float(np.sum((updated_memberships**fuzziness) * distance_squared))
        membership_change = float(np.max(np.abs(updated_memberships - memberships)))
        if previous_objective is not None:
            objective_change = abs(previous_objective - objective)
            if objective_change <= objective_tolerance:
                converged = True
                memberships = updated_memberships
                break
        previous_objective = objective
        memberships = updated_memberships

    memberships, distance_squared = memberships_from_centroids(
        features, centers, fuzziness
    )
    objective = float(np.sum((memberships**fuzziness) * distance_squared))
    center_distance_squared = np.sum(
        (centers[:, None, :] - centers[None, :, :]) ** 2, axis=2
    )
    np.fill_diagonal(center_distance_squared, np.inf)
    minimum_separation = float(np.min(center_distance_squared))
    xie_beni = (
        np.nan
        if minimum_separation <= 1e-12
        else objective / (len(features) * minimum_separation)
    )
    labels = memberships.argmax(axis=1).astype("int64")
    inertia = float(distance_squared[np.arange(len(features)), labels].sum())
    return {
        "centroids": centers,
        "memberships": memberships,
        "labels": labels,
        "objective": objective,
        "xie_beni": float(xie_beni),
        "inertia": inertia,
        "iterations": iterations,
        "converged": converged,
        "objective_change": float(objective_change),
        "membership_change": float(membership_change),
    }


def fit_incremental_fuzzy_movement(
    features: np.ndarray,
    existing_centroids: np.ndarray,
    existing_membership_mass: np.ndarray,
    unclassifiable_rows: np.ndarray,
    fuzziness: float = 2.0,
    maximum_iterations: int = 300,
    objective_tolerance: float = 0.01,
) -> dict[str, Any]:
    """Move existing MDFCM centres using the paper's incremental blend (Eqs. 14-16)."""
    features = np.asarray(features, dtype=float)
    starting_centres = np.asarray(existing_centroids, dtype=float)
    existing_mass = np.asarray(existing_membership_mass, dtype=float)
    unclassifiable = np.asarray(unclassifiable_rows, dtype=bool)
    cluster_count = len(starting_centres)
    if features.ndim != 2 or not len(features) or not np.isfinite(features).all():
        raise ValueError("Incremental FCM features must be a non-empty finite matrix")
    if starting_centres.ndim != 2 or not np.isfinite(starting_centres).all():
        raise ValueError("Incremental FCM centres must be a finite matrix")
    if existing_mass.shape != (cluster_count,) or not np.isfinite(existing_mass).all():
        raise ValueError("Existing-cluster membership mass must have one finite value per centre")
    if np.any(existing_mass < 0) or unclassifiable.shape != (len(features),):
        raise ValueError("Invalid existing membership mass or unclassifiable-row mask")

    memberships, _ = memberships_from_centroids(features, starting_centres, fuzziness)
    converged = False
    objective_change = np.inf
    membership_change = np.inf
    previous_objective: float | None = None
    centres = starting_centres.copy()

    for iteration in range(1, maximum_iterations + 1):
        labels = memberships.argmax(axis=1)
        eligible = ~unclassifiable
        moved_centres = starting_centres.copy()
        for index in range(cluster_count):
            weights = memberships[eligible, index] ** fuzziness
            if len(weights) == 0 or weights.sum() <= 1e-12:
                continue
            new_data_centre = (weights @ features[eligible]) / weights.sum()
            assigned_to_cluster = eligible & (labels == index)
            new_membership_mass = float(memberships[assigned_to_cluster, index].sum())
            total_mass = float(existing_mass[index] + new_membership_mass)
            blend_weight = new_membership_mass / total_mass if total_mass > 1e-12 else 0.0
            moved_centres[index] = (
                (1.0 - blend_weight) * starting_centres[index]
                + blend_weight * new_data_centre
            )

        centres = moved_centres
        updated_memberships, distance_squared = memberships_from_centroids(
            features, centres, fuzziness
        )
        objective = float(np.sum((updated_memberships**fuzziness) * distance_squared))
        membership_change = float(np.max(np.abs(updated_memberships - memberships)))
        if previous_objective is not None:
            objective_change = abs(previous_objective - objective)
            if objective_change <= objective_tolerance:
                converged = True
                memberships = updated_memberships
                break
        previous_objective = objective
        memberships = updated_memberships

    memberships, distance_squared = memberships_from_centroids(features, centres, fuzziness)
    objective = float(np.sum((memberships**fuzziness) * distance_squared))
    centre_distance_squared = np.sum(
        (centres[:, None, :] - centres[None, :, :]) ** 2, axis=2
    )
    np.fill_diagonal(centre_distance_squared, np.inf)
    minimum_separation = float(np.min(centre_distance_squared))
    xie_beni = (
        np.nan
        if minimum_separation <= 1e-12
        else objective / (len(features) * minimum_separation)
    )
    labels = memberships.argmax(axis=1).astype("int64")
    inertia = float(distance_squared[np.arange(len(features)), labels].sum())
    return {
        "centroids": centres,
        "memberships": memberships,
        "labels": labels,
        "objective": objective,
        "xie_beni": float(xie_beni),
        "inertia": inertia,
        "iterations": iteration,
        "converged": converged,
        "objective_change": float(objective_change),
        "membership_change": float(membership_change),
    }


def dynamic_fuzzy_update(
    features: np.ndarray,
    previous_centroids: np.ndarray,
    fuzziness: float = 2.0,
    alpha: float = 0.05,
    maximum_iterations: int = 300,
    tolerance: float = 0.01,
    previous_cluster_mass: np.ndarray | None = None,
) -> dict[str, Any]:
    previous_centroids = np.asarray(previous_centroids, dtype=float)
    current_k = len(previous_centroids)
    previous_memberships, previous_distances_squared = memberships_from_centroids(
        features, previous_centroids, fuzziness
    )
    previous_distances = np.sqrt(previous_distances_squared)
    condition_1_rows = np.max(
        np.abs(previous_memberships - (1.0 / current_k)), axis=1
    ) <= alpha
    condition_1_count = int(condition_1_rows.sum())

    if current_k > 1:
        center_distances = np.sqrt(
            np.sum(
                (previous_centroids[:, None, :] - previous_centroids[None, :, :]) ** 2,
                axis=2,
            )
        )
        # MDFCM Eq. (9) quantifies over every distinct centre pair. For each
        # centre i, an incoming point must exceed half the farthest i-to-p
        # separation; ignore the self-pair on the diagonal.
        np.fill_diagonal(center_distances, 0.0)
        condition_2_bounds = center_distances.max(axis=1) / 2.0
        condition_2_rows = np.all(previous_distances > condition_2_bounds[None, :], axis=1)
    else:
        condition_2_rows = np.zeros(len(features), dtype=bool)
    if current_k > 1 and not np.isfinite(condition_2_bounds).all():
        raise ValueError("MDFCM Condition 2 requires finite distinct-centre bounds")
    condition_2_count = int(condition_2_rows.sum())
    unclassifiable_rows = condition_1_rows & condition_2_rows
    if previous_cluster_mass is None:
        previous_cluster_mass = np.zeros(current_k, dtype=float)
    previous_cluster_mass = np.asarray(previous_cluster_mass, dtype=float)
    if previous_cluster_mass.shape != (current_k,):
        raise ValueError("Previous cluster membership mass does not match the current K")

    # Follow the MDFCM decision tree: condition 1 evaluates c-1 and c+1;
    # condition 2 evaluates c and c+1; both conditions evaluate all three;
    # neither condition moves the existing c-centre structure. Invalid K<2
    # alternatives are excluded because the Xie-Beni denominator is undefined.
    condition_1_met = condition_1_count > 0
    condition_2_met = condition_2_count > 0
    if condition_1_met and condition_2_met:
        candidate_counts = [current_k - 1, current_k, current_k + 1]
        decision = "conditions 1 and 2: compare valid c-1, c, c+1 candidates by Xie-Beni"
    elif condition_1_met:
        candidate_counts = [current_k - 1, current_k + 1]
        decision = "condition 1 only: compare valid c-1 and c+1 candidates by Xie-Beni"
    elif condition_2_met:
        candidate_counts = [current_k, current_k + 1]
        decision = "condition 2 only: compare c and c+1 candidates by Xie-Beni"
    else:
        candidate_counts = [current_k]
        decision = "neither condition: move the existing c-centre structure"

    def initializations_for_k(candidate_k: int) -> list[tuple[np.ndarray, str, list[int]]]:
        if candidate_k == current_k:
            return [(previous_centroids.copy(), "incremental_center_movement", [])]
        if candidate_k == current_k - 1:
            if current_k < 3:
                raise ValueError("Cannot evaluate c-1 with fewer than three current clusters")
            options = []
            for removed_cluster in range(current_k):
                kept_centres = np.delete(previous_centroids, removed_cluster, axis=0)
                options.append((
                    kept_centres,
                    "eliminate_one_cluster",
                    [int(removed_cluster)],
                ))
            return options
        if candidate_k == current_k + 1:
            nearest = previous_distances.argmin(axis=1)
            within_cluster_loss = np.array(
                [previous_distances_squared[nearest == index, index].sum() for index in range(current_k)]
            )
            options = []
            for split_cluster in range(current_k):
                members = features[nearest == split_cluster]
                if len(members) > 1:
                    centered = members - members.mean(axis=0)
                    covariance = np.cov(centered, rowvar=False)
                    covariance = np.atleast_2d(covariance)
                    _, eigenvectors = np.linalg.eigh(covariance)
                    direction = eigenvectors[:, -1]
                    spread = float(np.sqrt(max(within_cluster_loss[split_cluster] / len(members), 1e-8)))
                else:
                    direction = np.zeros(features.shape[1], dtype=float)
                    direction[0] = 1.0
                    spread = 1e-3
                offset = max(spread / 2.0, 1e-3) * direction
                centers = previous_centroids.copy()
                centers[split_cluster] -= offset
                options.append((
                    np.vstack([centers, previous_centroids[split_cluster] + offset]),
                    "split_one_cluster",
                    [int(split_cluster)],
                ))
            return options
        raise ValueError(f"Unsupported candidate cluster count: {candidate_k}")

    def fit_candidate(candidate_k: int) -> dict[str, Any]:
        fits = []
        for centers, initialization_action, source_clusters in initializations_for_k(candidate_k):
            if candidate_k == current_k and initialization_action == "incremental_center_movement":
                fitted = fit_incremental_fuzzy_movement(
                    features,
                    centers,
                    previous_cluster_mass,
                    unclassifiable_rows,
                    fuzziness=fuzziness,
                    maximum_iterations=maximum_iterations,
                    objective_tolerance=tolerance,
                )
            else:
                fitted = fit_fuzzy_c_means(
                    features,
                    candidate_k,
                    fuzziness=fuzziness,
                    maximum_iterations=maximum_iterations,
                    objective_tolerance=tolerance,
                    initial_centroids=centers,
                )
            fits.append({
                **fitted,
                "initialization_action": initialization_action,
                "source_clusters": source_clusters,
                "result_cluster_indexes": list(range(candidate_k)),
            })
        converged_fits = [
            fit
            for fit in fits
            if fit["converged"]
            and np.isfinite(fit["xie_beni"])
            and np.isfinite(fit["objective"])
        ]
        if not converged_fits:
            raise ValueError(
                f"MDFCM candidate K={candidate_k} has no converged fit with a finite Xie-Beni index"
            )
        return min(converged_fits, key=lambda fit: fit["xie_beni"])

    candidates: dict[int, dict[str, Any]] = {}
    for candidate_k in dict.fromkeys(candidate_counts):
        if candidate_k < 2 or candidate_k > len(features):
            continue
        candidates[candidate_k] = fit_candidate(candidate_k)
    usable = {k: result for k, result in candidates.items() if np.isfinite(result["xie_beni"])}
    if not usable:
        raise ValueError("MDFCM produced no valid candidate with a finite Xie-Beni index")
    selected_k = min(usable, key=lambda k: usable[k]["xie_beni"])
    selected = usable[selected_k]
    candidate_xb = {str(k): result["xie_beni"] for k, result in candidates.items()}
    candidate_details = {
        str(k): {
            "candidate_k": int(k),
            "xie_beni": float(result["xie_beni"]),
            "objective": float(result["objective"]),
            "iterations": int(result["iterations"]),
            "converged": bool(result["converged"]),
            "membership_change": float(result["membership_change"]),
            "objective_change": float(result["objective_change"]),
            "initialization_action": str(result["initialization_action"]),
            "source_clusters": [int(index) for index in result["source_clusters"]],
            "result_cluster_indexes": [int(index) for index in result["result_cluster_indexes"]],
        }
        for k, result in candidates.items()
    }
    labels = selected["labels"]
    return {
        **selected,
        "labels": labels,
        "condition_1_count": condition_1_count,
        "condition_2_count": condition_2_count,
        "condition_1_met": condition_1_met,
        "condition_2_met": condition_2_met,
        "decision": decision,
        "candidate_xb": candidate_xb,
        "candidate_details": candidate_details,
        "selected_k": selected_k,
        "alpha": alpha,
        "fuzziness": fuzziness,
        "convergence_tolerance": tolerance,
        "convergence_criterion": "absolute fuzzy-objective change <= E_FCM (0.01)",
    }


def previous_membership_mass_by_cluster(
    previous_state: pd.DataFrame,
    stable_id_by_local: dict[int, str],
    cluster_count: int,
) -> np.ndarray:
    """Sum prior memberships assigned to each still-fitted stable cluster ID."""
    stable_to_local = {stable_id: int(local) for local, stable_id in stable_id_by_local.items()}
    mass = np.zeros(cluster_count, dtype=float)
    if not stable_to_local:
        return mass

    for row in previous_state.itertuples(index=False):
        primary_stable_id = getattr(row, "Stable_Cluster_ID", None)
        if primary_stable_id not in stable_to_local:
            continue
        local_index = int(stable_to_local[primary_stable_id])
        if not 0 <= local_index < cluster_count:
            continue
        raw_details = getattr(row, "Fuzzy_Membership_Details", None)
        try:
            details = json.loads(raw_details) if raw_details else []
        except (TypeError, json.JSONDecodeError):
            details = []
        matching_membership = None
        for detail in details:
            if detail.get("stable_cluster_id") == primary_stable_id:
                try:
                    matching_membership = float(detail.get("membership", 0.0))
                except (TypeError, ValueError):
                    matching_membership = None
                break
        if matching_membership is None or not np.isfinite(matching_membership):
            try:
                matching_membership = float(getattr(row, "Highest_Membership_Score"))
            except (AttributeError, TypeError, ValueError):
                matching_membership = 1.0
        mass[local_index] += max(0.0, matching_membership)
    return mass


def classify_transition(is_new, previous_activity, current_activity, previous_cluster, current_cluster):
    if is_new or previous_cluster is None or pd.isna(previous_cluster):
        return "New"
    return "Existing Stable" if str(previous_cluster) == str(current_cluster) else "Existing Migrated"


def compatibility_migration_status(transition_status: str) -> str:
    if transition_status == "Existing Stable":
        return "Stable"
    if transition_status == "Existing Migrated":
        return "Migrated"
    return transition_status


def build_geographic_features(
    transactions: pd.DataFrame,
    customer_master: pd.DataFrame,
    behavioural_results: pd.DataFrame,
    cycle: CycleDefinition,
) -> pd.DataFrame:
    history = transactions.loc[transactions["InvoiceDate"] < cycle.snapshot_date]
    window = history.loc[history["InvoiceDate"] >= cycle.window_start]
    history_purchases = history.loc[history["Purchase_InvoiceNo"].notna()]
    window_purchases = window.loc[window["Purchase_InvoiceNo"].notna()]
    countries = sorted(history_purchases["Country"].dropna().unique().tolist())
    country_asof = customer_country_asof(transactions, cycle.snapshot_date)
    geographic = pd.DataFrame({"Country": countries}).set_index("Country")

    commercial = window.groupby("Country").agg(
        Revenue=("Total_Price", "sum"),
        Quantity=("Quantity", "sum"),
    )
    purchase_commercial = window_purchases.groupby("Country").agg(
        Active_Customer_Count=("CustomerID", "nunique"),
        Orders=("Purchase_InvoiceNo", "nunique"),
        Product_Diversity=("Description", "nunique"),
    )
    commercial = commercial.join(purchase_commercial, how="outer")
    customer_orders = (
        window_purchases.groupby(["Country", "CustomerID"])["Purchase_InvoiceNo"]
        .nunique()
        .rename("Customer_Orders")
        .reset_index()
    )
    repeat_rate = (
        customer_orders.assign(Is_Repeat=customer_orders["Customer_Orders"].ge(2).astype(float))
        .groupby("Country")["Is_Repeat"]
        .mean()
        .rename("Repeat_Purchase_Rate")
    )
    geographic = geographic.join(commercial, how="left").join(repeat_rate, how="left")
    numeric_defaults = [
        "Active_Customer_Count",
        "Revenue",
        "Orders",
        "Product_Diversity",
        "Quantity",
        "Repeat_Purchase_Rate",
    ]
    geographic[numeric_defaults] = geographic[numeric_defaults].fillna(0.0)

    composition_source = behavioural_results[
        ["CustomerID", "Segment_Name", "Risk_Status"]
    ].merge(country_asof, on="CustomerID", how="left")
    composition_counts = pd.crosstab(
        composition_source["Country"], composition_source["Segment_Name"]
    )
    composition_counts = composition_counts.reindex(index=geographic.index, fill_value=0)
    total_customers = composition_counts.sum(axis=1).rename("Customer_Count")
    geographic = geographic.join(total_customers, how="left")
    profile_rules = [
        ("Champions_Share", lambda names: names.isin(["Champions", "Champions at Risk"])),
        ("Loyalists_Share", lambda names: names.eq("Loyalists")),
        ("Mid_Tier_Occasionals_Share", lambda names: names.eq("Mid-Tier Occasionals")),
        ("Developing_Share", lambda names: names.eq("Developing")),
        ("Hibernating_Lost_Share", lambda names: names.eq("Hibernating / Lost")),
    ]
    family_map = {"High-Value Regulars":"Champions", "Valuable Customers at Risk":"Loyalists", "Mid-Tier Occasional":"Mid-Tier Occasionals", "Occasional Buyers at Risk":"Mid-Tier Occasionals", "Light Buyers":"Developing", "Light Buyers at Risk":"Developing"}
    profile_names = composition_source["Segment_Name"].fillna("").astype(str).map(base_profile).map(lambda name: family_map.get(name,name))
    for output_column, rule in profile_rules:
        customer_mask = rule(profile_names)
        segment_counts = (
            composition_source.loc[customer_mask]
            .groupby("Country")["CustomerID"]
            .nunique()
            .reindex(geographic.index, fill_value=0)
        )
        geographic[output_column] = segment_counts.div(
            geographic["Customer_Count"].replace(0, np.nan)
        ).fillna(0.0)
    risk_counts = (
        composition_source.loc[composition_source["Risk_Status"].isin(["At risk", "Slipping"])]
        .groupby("Country")["CustomerID"].nunique().reindex(geographic.index, fill_value=0)
    )
    geographic["At_Risk_Share"] = risk_counts.div(geographic["Customer_Count"].replace(0, np.nan)).fillna(0.0)
    assigned_profile_share = geographic[[column for column, _ in profile_rules]].sum(axis=1)
    geographic["Other_Customer_Segment_Share"] = (1.0 - assigned_profile_share).clip(0.0, 1.0)

    geographic["Orders_Per_Customer"] = geographic["Orders"].div(
        geographic["Active_Customer_Count"].replace(0, np.nan)
    ).fillna(0.0)
    geographic["Revenue_Per_Customer"] = geographic["Revenue"].div(
        geographic["Active_Customer_Count"].replace(0, np.nan)
    ).fillna(0.0)
    geographic["Log_Customer_Count"] = np.log1p(geographic["Customer_Count"])
    geographic["Log_Revenue"] = np.log1p(geographic["Revenue"].clip(lower=0))
    geographic["Log_Orders_Per_Customer"] = np.log1p(geographic["Orders_Per_Customer"])
    geographic["Log_Revenue_Per_Customer"] = np.log1p(geographic["Revenue_Per_Customer"])
    geographic["Log_Product_Diversity"] = np.log1p(geographic["Product_Diversity"])
    geographic["CycleID"] = cycle.cycle_id
    geographic["Cycle_End_Date"] = cycle.snapshot_date
    return geographic.reset_index()


def customer_country_asof(transactions: pd.DataFrame, snapshot_date: pd.Timestamp) -> pd.DataFrame:
    purchases = transactions.loc[
        transactions["Purchase_InvoiceNo"].notna()
        & transactions["InvoiceDate"].lt(snapshot_date)
        & transactions["Country"].notna()
    ]
    country_counts = (
        purchases.groupby(["CustomerID", "Country"])["Purchase_InvoiceNo"]
        .nunique()
        .rename("Country_Order_Count")
        .reset_index()
        .sort_values(
            ["CustomerID", "Country_Order_Count", "Country"],
            ascending=[True, False, True],
            kind="stable",
        )
    )
    return country_counts.drop_duplicates("CustomerID")[
        ["CustomerID", "Country"]
    ].reset_index(drop=True)


def order_geographic_clusters(
    baseline_features: pd.DataFrame,
    raw_labels: np.ndarray,
) -> tuple[dict[int, int], pd.DataFrame]:
    profile = baseline_features.assign(Raw_Cluster=raw_labels).groupby("Raw_Cluster").agg(
        Markets=("Country", "size"),
        Customer_Count=("Customer_Count", "sum"),
        Revenue=("Revenue", "sum"),
        Revenue_Per_Customer=("Revenue_Per_Customer", "mean"),
        Product_Diversity=("Product_Diversity", "mean"),
        Repeat_Purchase_Rate=("Repeat_Purchase_Rate", "mean"),
    )
    remaining = set(int(value) for value in profile.index)
    dominant = int(profile["Revenue"].idxmax())
    remaining.remove(dominant)
    high_value = int(profile.loc[list(remaining), "Revenue_Per_Customer"].idxmax())
    remaining.remove(high_value)
    other = int(next(iter(remaining)))
    mapping = {dominant: 0, high_value: 1, other: 2}
    profile["Geographic_Cluster_Number"] = [mapping[int(raw)] for raw in profile.index]
    profile["Geographic_Segment_Name"] = profile["Geographic_Cluster_Number"].map(
        GEOGRAPHIC_SEGMENTS
    )
    return mapping, profile.reset_index()


def firmographic_name(geographic_segment: str, behavioural_segment: str) -> str:
    prefixes = {
        "Largest Revenue Market": "Largest Revenue",
        "Highest Revenue-per-Customer Market": "Highest Revenue per Customer",
        "Other Markets": "Other Market",
    }
    prefix = prefixes.get(geographic_segment, geographic_segment.replace(" Market", ""))
    return f"{prefix} {behavioural_segment}"


SNAPSHOT_STATE_COLUMNS = ["Is_Model_Fit", "Current_Period_Orders", "Current_Period_Revenue", "Current_Period_Products", "Current_Period_Quantity"]

RISK_COLUMNS = [
    "Risk_Status", "Risk_Reasons", "Membership_Change",
    "Frequency_Change_Ratio", "Monetary_Change_Ratio",
]
RISK_POLICY = (
    "Customer warning flag, separate from model clusters and not a churn probability. "
    "Purchase gap >90 days is Lost; 61–90 days is Slipping; 31–60 days is At risk. Lost is excluded from at-risk assessment. "
    "For shorter purchase gaps, At risk also applies when: (1) comparable fuzzy fits for the same stable centre ID show "
    "a >=0.10 absolute fall in membership to that stable centre plus a >=25% fall in "
    "trailing-90-day frequency or paid sales monthly rate; or (2) both trailing-90-day frequency and paid "
    "sales fall >=50% from prior positive rates; or (3) no current-period purchases "
    "and purchase gap >30 days. Otherwise No risk flag, or No prior comparison when "
    "no earlier snapshot exists. The Cycle 0 crisp-to-fuzzy change is excluded from "
    "membership comparisons. All observed customers receive fresh memberships; prior "
    "snapshots of repeated IDs are not added as extra observations. Thresholds are transparent study rules, not learned predictions."
)


def add_customer_risk(snapshot: pd.DataFrame, previous: pd.DataFrame | None = None) -> pd.DataFrame:
    """Add an auditable warning flag without changing cluster assignments or memberships."""
    snapshot = snapshot.copy()
    prior = previous.set_index("CustomerID") if previous is not None else None
    values = []
    cycle_number = int(str(snapshot["CycleID"].iloc[0]).replace("Cycle_", ""))
    for row in snapshot.to_dict("records"):
        old = prior.loc[row["CustomerID"]] if prior is not None and row["CustomerID"] in prior.index else None
        f_ratio = m_ratio = membership_change = np.nan
        reasons = []
        if old is not None:
            for field in ["Frequency", "Monetary"]:
                old_value = float(old[field])
                ratio = float(row[field]) / old_value - 1.0 if old_value > 0 else np.nan
                if field == "Frequency":
                    f_ratio = ratio
                else:
                    m_ratio = ratio
            comparable = (
                cycle_number >= 2 and row["Stable_Cluster_ID"] == old["Stable_Cluster_ID"]
            )
            if comparable:
                def profile_membership(details_json: str, profile: str) -> float:
                    return sum(float(item["membership"]) for item in json.loads(details_json)
                               if item.get("stable_cluster_id") == profile)
                membership_change = (
                    profile_membership(row["Fuzzy_Membership_Details"], row["Stable_Cluster_ID"])
                    - profile_membership(old["Fuzzy_Membership_Details"], row["Stable_Cluster_ID"])
                )
                if membership_change <= -0.10 + 1e-12 and (f_ratio <= -0.25 + 1e-12 or m_ratio <= -0.25 + 1e-12):
                    reasons.append("Profile membership fell at least 10 percentage points and trailing-90-day frequency or paid sales monthly rate fell at least 25%")
            if f_ratio <= -0.50 + 1e-12 and m_ratio <= -0.50 + 1e-12:
                reasons.append("Trailing-90-day purchase frequency and paid sales monthly rates both fell at least 50%")
        if int(row["Recency"]) > 30:
            reasons.append("More than 30 days since the last qualifying purchase")
        if int(row["Recency"]) > 90:
            status, reason = "Lost", "More than 90 days since the last qualifying purchase; descriptive inactivity status, not proof the customer will never return"
        elif int(row["Recency"]) > 60:
            status, reason = "Slipping", "61–90 days since the last qualifying purchase"
        elif reasons:
            status, reason = "At risk", "; ".join(reasons)
        elif old is None:
            status, reason = "No prior comparison", "No earlier customer snapshot; purchase gap rule was checked"
        else:
            status, reason = "No risk flag", "No configured deterioration or purchase-gap rule was triggered"
        values.append([status, reason, membership_change, f_ratio, m_ratio])
    snapshot[RISK_COLUMNS] = pd.DataFrame(values, index=snapshot.index, columns=RISK_COLUMNS)
    return snapshot


def period_transaction_summary(
    transactions: pd.DataFrame,
    customer_labels: pd.DataFrame,
    cycle: CycleDefinition,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    period = transactions.loc[
        transactions["InvoiceDate"].ge(cycle.period_start)
        & transactions["InvoiceDate"].lt(cycle.period_end)
    ].copy()
    label_columns = [
        "CustomerID",
        "CycleID",
        "Cluster_Local_Index",
        "Stable_Cluster_ID",
        "Segment_Name",
        "Highest_Membership_Score",
        "Fuzzy_Membership_Details",
        "Assignment_Mode",
        "Activity_Status",
        "Migration_Status",
        "Transition_Status",
        *RISK_COLUMNS,
        *SNAPSHOT_STATE_COLUMNS,
    ]
    period = period.merge(customer_labels[label_columns], on="CustomerID", how="inner")
    period["CycleID"] = cycle.cycle_id
    period["Revenue"] = period["Total_Price"]

    sales_period = period.loc[period["Purchase_InvoiceNo"].notna()]
    purchase_activity = sales_period.groupby("CustomerID").agg(
        Orders=("Purchase_InvoiceNo", "nunique"),
        Products=("Description", "nunique"),
    )
    financial_activity = period.groupby("CustomerID").agg(
        Quantity=("Quantity", "sum"),
        Revenue=("Revenue", "sum"),
    )
    activity = financial_activity.join(purchase_activity, how="outer")
    customer_state_columns = [
        "CustomerID",
        "CycleID",
        "Cluster_Local_Index",
        "Stable_Cluster_ID",
        "Segment_Name",
        "Highest_Membership_Score",
        "Fuzzy_Membership_Details",
        "Assignment_Mode",
        "Activity_Status",
        "Migration_Status",
        "Transition_Status",
        *RISK_COLUMNS,
        *SNAPSHOT_STATE_COLUMNS,
    ]
    customers = customer_labels[customer_state_columns].set_index("CustomerID").join(
        activity, how="left"
    )
    customers[["Orders", "Products", "Quantity", "Revenue"]] = customers[
        ["Orders", "Products", "Quantity", "Revenue"]
    ].fillna(0.0)
    customers["Average_Basket_Value"] = customers["Revenue"].div(
        customers["Orders"].replace(0, np.nan)
    ).fillna(0.0)
    customer_summary = customers.reset_index()[
        [
            "CycleID",
            "CustomerID",
            "Cluster_Local_Index",
            "Stable_Cluster_ID",
            "Segment_Name",
            "Activity_Status",
            "Assignment_Mode",
            "Orders",
            "Products",
            "Quantity",
            "Revenue",
            "Highest_Membership_Score",
            "Migration_Status",
            "Transition_Status",
            "Average_Basket_Value",
            *RISK_COLUMNS,
            *SNAPSHOT_STATE_COLUMNS,
        ]
    ].rename(columns={"Highest_Membership_Score": "Average_Membership"})

    customer_summary["Is_At_Risk"] = customer_summary["Risk_Status"].isin(["At risk", "Slipping"]).astype(int)
    segment_summary = customer_summary.groupby(
        ["CycleID", "Stable_Cluster_ID", "Segment_Name"]
    ).agg(
        Customers=("CustomerID", "size"),
        Orders=("Orders", "sum"),
        Quantity=("Quantity", "sum"),
        Revenue=("Revenue", "sum"),
        Average_Membership=("Average_Membership", "mean"),
        At_Risk_Customers=("Is_At_Risk", "sum"),
        At_Risk_Share=("Is_At_Risk", "mean"),
    ).reset_index()
    segment_summary["Average_Order_Value"] = segment_summary["Revenue"].div(
        segment_summary["Orders"].replace(0, np.nan)
    ).fillna(0.0)
    segment_summary["Revenue_Per_Customer"] = segment_summary["Revenue"].div(
        segment_summary["Customers"].replace(0, np.nan)
    ).fillna(0.0)

    product_summary = period.groupby(
        ["CycleID", "Stable_Cluster_ID", "Segment_Name", "Description"]
    ).agg(
        Quantity_Sold=("Quantity", "sum"),
        Revenue=("Revenue", "sum"),
        Customer_Count=("CustomerID", "nunique"),
        Orders=("InvoiceNo", "nunique"),
        Average_Price=("UnitPrice", "mean"),
    ).reset_index()
    return period, customer_summary, segment_summary, product_summary


def run_pipeline(source_path: Path) -> PipelineArtifacts:
    start_time = time.perf_counter()
    transactions = load_transactions(source_path)
    customer_master = build_customer_master(transactions)
    cycle_definitions = build_cycle_definitions(transactions)

    baseline_raw = build_behavioural_snapshot(
        transactions, customer_master, cycle_definitions[0]
    )
    scaler = MinMaxScaler()
    baseline_scaled = scaler.fit_transform(baseline_raw[FEATURE_COLUMNS])
    pca = PCA(n_components=3, random_state=RANDOM_STATE)
    baseline_pca = pca.fit_transform(baseline_scaled)
    selected_k, elbow_results = select_elbow_k(baseline_pca)
    baseline = baseline_raw.copy()
    baseline[SCALED_FEATURE_COLUMNS] = baseline_scaled
    baseline[PCA_COLUMNS] = baseline_pca

    baseline_kmeans = KMeans(n_clusters=selected_k, n_init=50, random_state=RANDOM_STATE)
    raw_baseline_labels = baseline_kmeans.fit_predict(baseline_pca)
    baseline_mapping, _ = order_baseline_clusters(baseline, raw_baseline_labels)
    baseline_labels = np.array([baseline_mapping[int(label)] for label in raw_baseline_labels])
    ordered_centroids = np.zeros_like(baseline_kmeans.cluster_centers_)
    for raw_cluster, canonical_cluster in baseline_mapping.items():
        ordered_centroids[canonical_cluster] = baseline_kmeans.cluster_centers_[raw_cluster]
    baseline_metrics = safe_cluster_metrics(baseline_pca, baseline_labels)
    baseline["KMeans_Cluster_Number"] = baseline_labels
    baseline_name_map = name_rfm_clusters(baseline, baseline_labels, centroids=ordered_centroids)
    baseline["Model_Profile_Name"] = baseline["KMeans_Cluster_Number"].map(baseline_name_map)
    baseline["Segment_Name"] = baseline["Model_Profile_Name"]
    baseline_stable_ids = {index: f"CL-{index + 1:03d}" for index in range(selected_k)}
    baseline["Stable_Cluster_ID"] = baseline["KMeans_Cluster_Number"].map(baseline_stable_ids)
    baseline["Cluster_Local_Index"] = baseline["KMeans_Cluster_Number"]
    baseline["Highest_Membership_Score"] = 1.0
    baseline["All_Fuzzy_Memberships"] = [
        json.dumps([1.0 if index == int(label) else 0.0 for index in range(selected_k)])
        for label in baseline["KMeans_Cluster_Number"]
    ]
    baseline["Fuzzy_Membership_Details"] = [
        json.dumps([
            {
                "cluster_index": index,
                "stable_cluster_id": baseline_stable_ids[index],
                "segment_name": baseline_name_map[index],
                "membership": 1.0 if index == int(label) else 0.0,
            }
            for index in range(selected_k)
        ])
        for label in baseline["KMeans_Cluster_Number"]
    ]
    baseline["Transition_Status"] = "Baseline"
    baseline["Migration_Status"] = "Baseline"
    baseline["PreviousCycleID"] = None
    baseline["CurrentCycleID"] = "Cycle_0"

    baseline = add_customer_risk(baseline)
    preprocessing_frames = [baseline]
    dynamic_frames: list[pd.DataFrame] = []
    transition_frames: list[pd.DataFrame] = []
    cluster_lineage_frames: list[pd.DataFrame] = []
    cycle_summary_rows: list[dict[str, Any]] = []
    candidate_evaluation_rows: list[dict[str, Any]] = []
    centroid_rows: list[dict[str, Any]] = []
    customer_summary_frames: list[pd.DataFrame] = []
    segment_summary_frames: list[pd.DataFrame] = []
    product_summary_frames: list[pd.DataFrame] = []
    business_frames: list[pd.DataFrame] = []
    behavioural_by_cycle: dict[str, pd.DataFrame] = {"Cycle_0": baseline}

    previous_state = baseline[
        ["CustomerID", "KMeans_Cluster_Number", "Stable_Cluster_ID", "Activity_Status", "Segment_Name", "Model_Profile_Name", "Fuzzy_Membership_Details", "All_Fuzzy_Memberships", "Frequency", "Monetary", *PCA_COLUMNS]
    ].rename(
        columns={
            "KMeans_Cluster_Number": "Cluster_Local_Index",
        }
    )
    previous_centroids = ordered_centroids
    previous_stable_id_by_local = dict(baseline_stable_ids)
    next_cluster_number = selected_k + 1

    for cycle in cycle_definitions[1:]:
        cycle_start = time.perf_counter()
        raw_snapshot = build_behavioural_snapshot(transactions, customer_master, cycle)
        snapshot = transform_snapshot(raw_snapshot, scaler, pca)
        features = snapshot[PCA_COLUMNS].to_numpy()
        active_mask = np.ones(len(snapshot), dtype=bool)
        active_features = features
        active_snapshot = snapshot.reset_index(drop=True)
        if len(snapshot) < 2:
            raise ValueError(f"{cycle.cycle_id} has fewer than two observed customers")
        previous_cluster_mass = previous_membership_mass_by_cluster(
            previous_state.loc[~previous_state["CustomerID"].isin(snapshot["CustomerID"])],
            previous_stable_id_by_local, len(previous_centroids)
        )
        fuzzy = dynamic_fuzzy_update(
            active_features,
            previous_centroids,
            previous_cluster_mass=previous_cluster_mass,
        )
        stable_id_map, next_cluster_number, lineage = match_cluster_ids(
            previous_centroids,
            previous_state,
            fuzzy["centroids"],
            active_snapshot["CustomerID"],
            fuzzy["labels"],
            next_cluster_number,
            cycle.cycle_id,
            current_memberships=fuzzy["memberships"],
            previous_stable_id_by_local=previous_stable_id_by_local,
        )
        cluster_lineage_frames.append(lineage)
        previous_id_by_local = previous_stable_id_by_local
        for candidate_k, candidate in fuzzy["candidate_details"].items():
            source_clusters = candidate["source_clusters"]
            is_selected_candidate = int(int(candidate_k) == int(fuzzy["selected_k"]))
            result_cluster_indexes = candidate["result_cluster_indexes"] if is_selected_candidate else []
            source_stable_ids = [
                str(previous_id_by_local[index])
                for index in source_clusters
                if index in previous_id_by_local
            ]
            candidate_evaluation_rows.append({
                "CycleID": cycle.cycle_id,
                "PreviousK": int(len(previous_centroids)),
                "CandidateK": int(candidate_k),
                "InitializationAction": candidate["initialization_action"],
                "SourceLocalClusters": json.dumps(source_clusters),
                "SourceStableClusterIDs": json.dumps(source_stable_ids),
                "ResultLocalClusters": json.dumps(result_cluster_indexes),
                "ResultStableClusterIDs": json.dumps([
                    str(stable_id_map[index]) for index in result_cluster_indexes
                ]),
                "XieBeniIndex": float(candidate["xie_beni"]),
                "FuzzyObjective": float(candidate["objective"]),
                "Iterations": int(candidate["iterations"]),
                "Converged": int(candidate["converged"]),
                "FinalMembershipChange": float(candidate["membership_change"]),
                "FinalObjectiveChange": float(candidate["objective_change"]),
                "ConvergenceTolerance": float(fuzzy["convergence_tolerance"]),
                "Selected": is_selected_candidate,
            })
        segment_name_map = name_rfm_clusters(
            active_snapshot,
            fuzzy["labels"],
            cluster_count=len(fuzzy["centroids"]),
            fuzzy_memberships=fuzzy["memberships"],
            centroids=fuzzy["centroids"],
        )
        membership_matrix = fuzzy["memberships"]
        local_labels = fuzzy["labels"]
        assignment_modes = np.full(len(snapshot), "Current-cycle fuzzy fit", dtype=object)
        snapshot["MDFCM_Cluster_Number"] = local_labels
        snapshot["PreviousCycleID"] = f"Cycle_{cycle.cycle_number - 1}"
        snapshot["CurrentCycleID"] = cycle.cycle_id
        snapshot["Cluster_Local_Index"] = local_labels
        snapshot["Stable_Cluster_ID"] = [stable_id_map[int(local)] for local in local_labels]
        snapshot["Model_Profile_Name"] = [segment_name_map[int(local)] for local in local_labels]
        snapshot["Segment_Name"] = snapshot["Model_Profile_Name"]
        snapshot["Assignment_Mode"] = assignment_modes
        snapshot["Highest_Membership_Score"] = membership_matrix.max(axis=1)
        snapshot["All_Fuzzy_Memberships"] = [json.dumps([round(float(value),8) for value in vector]) for vector in membership_matrix]
        snapshot["Fuzzy_Membership_Details"] = [json.dumps([
            {"cluster_index": index, "stable_cluster_id": stable_id_map[index],
             "segment_name": segment_name_map[index], "membership": round(float(value),8)}
            for index,value in enumerate(vector)
        ]) for vector in membership_matrix]
        snapshot = add_customer_risk(snapshot, previous_state)
        previous_state_for_merge = previous_state.rename(
            columns={
                "Cluster_Local_Index": "Previous_Cluster_Local_Index",
                "Stable_Cluster_ID": "Previous_Stable_Cluster_ID",
                "Activity_Status": "Previous_Activity_Status",
                "Segment_Name": "Previous_Segment_Name",
                "Fuzzy_Membership_Details": "Previous_Fuzzy_Membership_Details",
                "All_Fuzzy_Memberships": "Previous_All_Fuzzy_Memberships",
                "Model_Profile_Name": "Previous_Model_Profile_Name",
                "Frequency": "Previous_Frequency",
                "Monetary": "Previous_Monetary",
                **{column: f"Previous_{column}" for column in PCA_COLUMNS},
            }
        )
        snapshot = snapshot.merge(previous_state_for_merge, on="CustomerID", how="left")
        counterfactual_memberships, _ = memberships_from_centroids(features, previous_centroids, 2.0)
        counterfactual_local = counterfactual_memberships.argmax(axis=1)
        snapshot["Previous_Centroid_Assigned_Stable_ID"] = [
            previous_id_by_local[int(index)] for index in counterfactual_local
        ]
        snapshot["Transition_Status"] = [
            classify_transition(
                int(row.Is_New),
                None if pd.isna(row.Previous_Activity_Status) else str(row.Previous_Activity_Status),
                str(row.Activity_Status),
                None if pd.isna(row.Previous_Stable_Cluster_ID) else str(row.Previous_Stable_Cluster_ID),
                str(row.Stable_Cluster_ID),
            )
            for row in snapshot.itertuples(index=False)
        ]
        snapshot["Migration_Status"] = snapshot["Transition_Status"].map(
            compatibility_migration_status
        )
        snapshot["Feature_Displacement"] = np.sqrt(
            sum(
                (snapshot[column].astype(float) - snapshot[f"Previous_{column}"].astype(float)) ** 2
                for column in PCA_COLUMNS
            )
        )
        snapshot["Migration_Cause"] = np.select(
            [
                snapshot["Transition_Status"].eq("New"),
                snapshot["Transition_Status"].eq("Reactivated"),
                snapshot["Transition_Status"].eq("Inactive"),
                snapshot["Transition_Status"].eq("Existing Stable"),
                snapshot["Transition_Status"].eq("Existing Migrated")
                & snapshot["Previous_Centroid_Assigned_Stable_ID"].ne(snapshot["Previous_Stable_Cluster_ID"]),
                snapshot["Transition_Status"].eq("Existing Migrated"),
            ],
            ["New customer", "Reactivated", "Inactive this cycle", "No hard-cluster migration", "Behavioral shift across prior boundary", "Boundary or cluster-structure change"],
            default="Not classified",
        )
        snapshot["Fuzzy_Objective"] = fuzzy["objective"]
        snapshot["Xie_Beni_Index"] = fuzzy["xie_beni"]
        snapshot["MDFCM_Condition_1_Met"] = int(fuzzy["condition_1_met"])
        snapshot["MDFCM_Condition_2_Met"] = int(fuzzy["condition_2_met"])
        snapshot["MDFCM_Condition_1_Count"] = int(fuzzy["condition_1_count"])
        snapshot["MDFCM_Condition_2_Count"] = int(fuzzy["condition_2_count"])
        snapshot["MDFCM_Decision"] = fuzzy["decision"]
        snapshot["MDFCM_Selected_K"] = int(fuzzy["selected_k"])
        snapshot["MDFCM_Candidate_XB"] = json.dumps(fuzzy["candidate_xb"], sort_keys=True)
        snapshot["MDFCM_Alpha"] = float(fuzzy["alpha"])
        snapshot["MDFCM_Fuzziness"] = float(fuzzy["fuzziness"])
        snapshot["MDFCM_Convergence_Tolerance"] = float(fuzzy["convergence_tolerance"])
        snapshot["MDFCM_Convergence_Criterion"] = fuzzy["convergence_criterion"]
        snapshot["Updated_Centroids"] = json.dumps(
            [[round(float(value), 8) for value in row] for row in fuzzy["centroids"]]
        )

        metrics = safe_cluster_metrics(active_features, fuzzy["labels"])
        comparable = snapshot["Transition_Status"].isin(
            ["Existing Stable", "Existing Migrated"]
        )
        stable_count = int(snapshot["Transition_Status"].eq("Existing Stable").sum())
        migrated_count = int(snapshot["Transition_Status"].eq("Existing Migrated").sum())
        comparable_count = int(comparable.sum())
        migration_rate = 100.0 * migrated_count / comparable_count if comparable_count else 0.0
        centroid_pair_distances = np.sqrt(
            np.sum((previous_centroids[:, None, :] - fuzzy["centroids"][None, :, :]) ** 2, axis=2)
        )
        centroid_shift = float(
            (centroid_pair_distances.min(axis=1).mean() + centroid_pair_distances.min(axis=0).mean())
            / 2.0
        )
        cycle_summary_rows.append(
            {
                "CycleID": cycle.cycle_id,
                "CustomersProcessed": int(len(snapshot)),
                "ModelFitCustomers": int(active_mask.sum()),
                "RetainedInactiveCustomers": int(sum(
                    str(mode).startswith("Retained prior membership") for mode in assignment_modes
                )),
                "ActiveCustomers": int(snapshot["Activity_Status"].eq("Active").sum()),
                "InactiveCustomers": int(snapshot["Activity_Status"].eq("Inactive").sum()),
                "NewCustomers": int(snapshot["Transition_Status"].eq("New").sum()),
                "ReactivatedCustomers": int((snapshot["Previous_Activity_Status"].eq("Inactive") & snapshot["Activity_Status"].eq("Active")).sum()),
                "HistoricalMembershipMassUsed": float(previous_cluster_mass.sum()),
                "InputSnapshotPolicy": "Full replacement snapshot; one current row per observed customer",
                "StableCustomers": stable_count,
                "MigratedCustomers": migrated_count,
                "ComparableCustomers": comparable_count,
                "MigrationRate": migration_rate,
                "CentroidShift": centroid_shift,
                "Iterations": int(fuzzy["iterations"]),
                "SelectedK": int(fuzzy["selected_k"]),
                "Condition1Met": int(fuzzy["condition_1_met"]),
                "Condition2Met": int(fuzzy["condition_2_met"]),
                "Condition1ObservationCount": int(fuzzy["condition_1_count"]),
                "Condition2ObservationCount": int(fuzzy["condition_2_count"]),
                "MDFCMDecision": fuzzy["decision"],
                "SelectedOperation": fuzzy["candidate_details"][str(fuzzy["selected_k"])]["initialization_action"],
                "SelectedSourceLocalClusters": json.dumps(
                    fuzzy["candidate_details"][str(fuzzy["selected_k"])]["source_clusters"]
                ),
                "SelectedSourceStableClusterIDs": json.dumps([
                    str(previous_id_by_local[index])
                    for index in fuzzy["candidate_details"][str(fuzzy["selected_k"])]["source_clusters"]
                    if index in previous_id_by_local
                ]),
                "SelectedResultLocalClusters": json.dumps(
                    fuzzy["candidate_details"][str(fuzzy["selected_k"])]["result_cluster_indexes"]
                ),
                "SelectedResultStableClusterIDs": json.dumps([
                    str(stable_id_map[index])
                    for index in fuzzy["candidate_details"][str(fuzzy["selected_k"])]["result_cluster_indexes"]
                ]),
                "CandidateXB": json.dumps(fuzzy["candidate_xb"], sort_keys=True),
                "MDFCMAlpha": float(fuzzy["alpha"]),
                "Fuzziness": float(fuzzy["fuzziness"]),
                "ConvergenceTolerance": float(fuzzy["convergence_tolerance"]),
                "ConvergenceCriterion": fuzzy["convergence_criterion"],
                "SilhouetteScore": metrics["silhouette"],
                "DaviesBouldinScore": metrics["davies_bouldin"],
                "CalinskiHarabaszScore": metrics["calinski_harabasz"],
                "XieBeniIndex": fuzzy["xie_beni"],
                "FuzzyObjective": fuzzy["objective"],
                "AverageMembership": float(fuzzy["memberships"].max(axis=1).mean()),
                "NetGrossMonetaryRankCorrelation": np.nan,
                "MonetaryRankQuartileChangedCustomers": np.nan,
                "MonetaryRankQuartileChangedShare": np.nan,
                "ProcessingTime": float(time.perf_counter() - cycle_start),
                "ProcessingDate": pd.Timestamp.utcnow().isoformat(),
                "Converged": int(fuzzy["converged"]),
            }
        )
        for cluster_id, centroid in enumerate(fuzzy["centroids"]):
            centroid_rows.append(
                {
                    "CycleID": cycle.cycle_id,
                    "ClusterID": cluster_id,
                    "PC1": float(centroid[0]),
                    "PC2": float(centroid[1]),
                    "PC3": float(centroid[2]),
                }
            )

        dynamic_frames.append(snapshot)
        preprocessing_frames.append(snapshot)
        behavioural_by_cycle[cycle.cycle_id] = snapshot
        transition_frames.append(
            snapshot[
                [
                    "CustomerID",
                    "CycleID",
                    "PreviousCycleID",
                    "CurrentCycleID",
                    "Cluster_Local_Index",
                    "MDFCM_Cluster_Number",
                    "Stable_Cluster_ID",
                    "Previous_Stable_Cluster_ID",
                    "Model_Profile_Name",
                    "Segment_Name",
                    "Previous_Segment_Name",
                    "Previous_Cluster_Local_Index",
                    "Previous_Activity_Status",
                    "Activity_Status",
                    "Assignment_Mode",
                    "Transition_Status",
                    "Migration_Status",
                    "Highest_Membership_Score",
                    "Fuzzy_Membership_Details",
                    "Previous_Centroid_Assigned_Stable_ID",
                    "Feature_Displacement",
                    "Migration_Cause",
                ]
            ].copy()
        )
        period, customers, segments, products = period_transaction_summary(
            transactions, snapshot, cycle
        )
        customer_summary_frames.append(customers)
        segment_summary_frames.append(segments)
        product_summary_frames.append(products)
        business_frames.append(period)

        previous_state = snapshot[
            ["CustomerID", "MDFCM_Cluster_Number", "Stable_Cluster_ID", "Activity_Status", "Segment_Name", "Model_Profile_Name", "Fuzzy_Membership_Details", "All_Fuzzy_Memberships", "Frequency", "Monetary", *PCA_COLUMNS]
        ].rename(
            columns={
                "MDFCM_Cluster_Number": "Cluster_Local_Index",
            }
        )
        previous_centroids = fuzzy["centroids"]
        previous_stable_id_by_local = stable_id_map

    preprocessing = pd.concat(preprocessing_frames, ignore_index=True)
    dynamic_results = pd.concat(dynamic_frames, ignore_index=True)
    customer_transitions = pd.concat(transition_frames, ignore_index=True)
    cluster_lineage = pd.concat(cluster_lineage_frames, ignore_index=True)
    cycle_summary = pd.DataFrame(cycle_summary_rows)
    mdfcm_candidate_evaluations = pd.DataFrame(candidate_evaluation_rows)
    centroids = pd.DataFrame(centroid_rows)
    customer_summary = pd.concat(customer_summary_frames, ignore_index=True)
    segment_summary = pd.concat(segment_summary_frames, ignore_index=True)
    product_summary = pd.concat(product_summary_frames, ignore_index=True)
    business_analytics = pd.concat(business_frames, ignore_index=True)

    geographic_raw_by_cycle: dict[str, pd.DataFrame] = {}
    for cycle in cycle_definitions:
        geographic_raw_by_cycle[cycle.cycle_id] = build_geographic_features(
            transactions,
            customer_master,
            behavioural_by_cycle[cycle.cycle_id],
            cycle,
        )
    geographic_scaler = RobustScaler()
    baseline_geographic_raw = geographic_raw_by_cycle["Cycle_0"]
    baseline_geographic_scaled = geographic_scaler.fit_transform(
        baseline_geographic_raw[GEOGRAPHIC_FEATURE_COLUMNS]
    )
    geographic_kmeans = KMeans(n_clusters=3, n_init=50, random_state=RANDOM_STATE)
    baseline_geographic_labels_raw = geographic_kmeans.fit_predict(baseline_geographic_scaled)
    geographic_mapping, _ = order_geographic_clusters(
        baseline_geographic_raw, baseline_geographic_labels_raw
    )

    geographic_feature_frames: list[pd.DataFrame] = []
    geographic_segmentation_frames: list[pd.DataFrame] = []
    geographic_cycle_rows: list[dict[str, Any]] = []
    firmographic_frames: list[pd.DataFrame] = []
    for cycle in cycle_definitions:
        geographic_features = geographic_raw_by_cycle[cycle.cycle_id].copy()
        geographic_scaled = geographic_scaler.transform(
            geographic_features[GEOGRAPHIC_FEATURE_COLUMNS]
        )
        raw_labels = geographic_kmeans.predict(geographic_scaled)
        geographic_features["Geographic_Cluster_Number"] = [
            geographic_mapping[int(label)] for label in raw_labels
        ]
        geographic_features["Geographic_Segment_Name"] = geographic_features[
            "Geographic_Cluster_Number"
        ].map(GEOGRAPHIC_SEGMENTS)
        for index, column in enumerate(GEOGRAPHIC_FEATURE_COLUMNS):
            geographic_features[f"Scaled_{column}"] = geographic_scaled[:, index]
        geographic_feature_frames.append(geographic_features)
        geographic_segmentation_frames.append(
            geographic_features[
                [
                    "CycleID",
                    "Country",
                    "Geographic_Cluster_Number",
                    "Geographic_Segment_Name",
                    "Customer_Count",
                    "Active_Customer_Count",
                    "Revenue",
                    "Orders",
                    "Product_Diversity",
                    "Orders_Per_Customer",
                    "Revenue_Per_Customer",
                    "Repeat_Purchase_Rate",
                    "Champions_Share",
                    "Loyalists_Share",
                    "Mid_Tier_Occasionals_Share",
                    "Developing_Share",
                    "Hibernating_Lost_Share",
                    "At_Risk_Share",
                ]
            ].copy()
        )
        geo_metrics = safe_cluster_metrics(
            geographic_scaled,
            geographic_features["Geographic_Cluster_Number"].to_numpy(),
        )
        geographic_cycle_rows.append(
            {
                "CycleID": cycle.cycle_id,
                "Markets": int(len(geographic_features)),
                "SilhouetteScore": geo_metrics["silhouette"],
                "DaviesBouldinScore": geo_metrics["davies_bouldin"],
                "CalinskiHarabaszScore": geo_metrics["calinski_harabasz"],
            }
        )

        behavioural = behavioural_by_cycle[cycle.cycle_id][
            [
                "CustomerID",
                "CycleID",
                "Segment_Name",
                "Activity_Status",
                "Highest_Membership_Score",
                *RISK_COLUMNS,
            *SNAPSHOT_STATE_COLUMNS,
            ]
        ].merge(customer_country_asof(transactions, cycle.snapshot_date), on="CustomerID", how="left")
        firmographic = behavioural.merge(
            geographic_features[
                [
                    "CycleID",
                    "Country",
                    "Geographic_Cluster_Number",
                    "Geographic_Segment_Name",
                ]
            ],
            on=["CycleID", "Country"],
            how="left",
        )
        firmographic["Firmographic_Segment_Name"] = [
            firmographic_name(geographic, behavioural_name)
            for geographic, behavioural_name in zip(
                firmographic["Geographic_Segment_Name"],
                firmographic["Segment_Name"],
            )
        ]
        firmographic_frames.append(firmographic)

    geographic_features = pd.concat(geographic_feature_frames, ignore_index=True)
    geographic_segmentation = pd.concat(geographic_segmentation_frames, ignore_index=True)
    geographic_cycle_summary = pd.DataFrame(geographic_cycle_rows)
    firmographic_segmentation = pd.concat(firmographic_frames, ignore_index=True)

    baseline_segmentation = baseline[
        [
            "CustomerID",
            "Cluster_Local_Index",
            "Stable_Cluster_ID",
            "KMeans_Cluster_Number",
            "Model_Profile_Name",
            "Segment_Name",
            *RISK_COLUMNS,
            *SNAPSHOT_STATE_COLUMNS,
            "Recency",
            "Frequency",
            "Monetary",
            "All_Fuzzy_Memberships",
            "Fuzzy_Membership_Details",
            "PC1",
            "PC2",
            "PC3",
        ]
    ].copy()
    baseline_segmentation["Optimal_K_Value"] = selected_k
    baseline_segmentation["Elbow_Inertia_Value"] = float(baseline_kmeans.inertia_)
    baseline_segmentation["Silhouette_Score"] = baseline_metrics["silhouette"]
    baseline_segmentation["Davies_Bouldin_Score"] = baseline_metrics["davies_bouldin"]
    baseline_segmentation["Calinski_Harabasz_Score"] = baseline_metrics["calinski_harabasz"]
    baseline_segmentation["Initial_Centroids"] = json.dumps(
        [[round(float(value), 8) for value in row] for row in ordered_centroids]
    )

    elapsed = time.perf_counter() - start_time
    print(f"Corrected pipeline completed in {elapsed:.2f} seconds")
    return PipelineArtifacts(
        transactions=transactions,
        customer_master=customer_master,
        cycle_definitions=cycle_definitions,
        preprocessing=preprocessing,
        baseline_segmentation=baseline_segmentation,
        elbow_results=elbow_results,
        dynamic_results=dynamic_results,
        customer_transitions=customer_transitions,
        cycle_summary=cycle_summary,
        mdfcm_candidate_evaluations=mdfcm_candidate_evaluations,
        centroids=centroids,
        cluster_lineage=cluster_lineage,
        customer_summary=customer_summary,
        segment_summary=segment_summary,
        product_summary=product_summary,
        business_analytics=business_analytics,
        geographic_features=geographic_features,
        geographic_segmentation=geographic_segmentation,
        geographic_cycle_summary=geographic_cycle_summary,
        firmographic_segmentation=firmographic_segmentation,
        scaler=scaler,
        pca=pca,
        baseline_kmeans=baseline_kmeans,
        geographic_scaler=geographic_scaler,
        geographic_kmeans=geographic_kmeans,
        behavioural_cluster_mapping=baseline_mapping,
        geographic_cluster_mapping=geographic_mapping,
    )


def prepare_figure_directories(model_directory: Path) -> Path:
    corrected_directory = model_directory / "Research_Figures"
    for child in [
        "Baseline",
        "Behavioural",
        "Dynamic",
        "Geographic",
        "Firmographic",
        "Validation",
    ]:
        (corrected_directory / child).mkdir(parents=True, exist_ok=True)
    return corrected_directory


def save_models(artifacts: PipelineArtifacts, model_directory: Path) -> None:
    model_directory.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifacts.scaler, model_directory / "cycle0_feature_scaler.pkl")
    joblib.dump(artifacts.pca, model_directory / "cycle0_pca_model.pkl")
    joblib.dump(artifacts.baseline_kmeans, model_directory / "cycle0_kmeans_model.pkl")
    joblib.dump(artifacts.geographic_scaler, model_directory / "cycle0_geographic_scaler.pkl")
    joblib.dump(artifacts.geographic_kmeans, model_directory / "cycle0_geographic_kmeans.pkl")
    behavioural_segments_by_cycle = {
        "Cycle_0": sorted(artifacts.baseline_segmentation["Segment_Name"].dropna().unique().tolist())
    }
    for cycle in artifacts.cycle_definitions[1:]:
        behavioural_segments_by_cycle[cycle.cycle_id] = sorted(
            artifacts.dynamic_results.loc[
                artifacts.dynamic_results["CycleID"].eq(cycle.cycle_id), "Segment_Name"
            ].dropna().unique().tolist()
        )
    model_metadata = {
        "preprocessing_sequence": ["Clean missing/invalid records, exact deduplication, positive linked paid sales", "Full observed-customer snapshots; uncapped Recency; exact trailing90-day F/M totals normalized by3 in EVERYcycle; current-period commerce separately", "log1p R/F/M then logged RF/RM/FM products", "C0-only MinMax scaling", "C0-only three-component PCA", "Static C0 K-means; full-replacement snapshot MDFCM C1–9"],
        "behavioural_features": FEATURE_COLUMNS,
        "geographic_features": GEOGRAPHIC_FEATURE_COLUMNS,
        "behavioural_segments_by_cycle": behavioural_segments_by_cycle,
        "customer_risk_policy": RISK_POLICY,
        "reporting_label_policy": LABEL_POLICY,
        "rolling_window_days": 90,
        "fit_population": "All customers observed before the snapshot; Is_Model_Fit=1 even without current-period purchases",
        "snapshot_weighting": "Prior IDs included in the incoming full snapshot contribute zero additional historical mass; previous centres remain warm starts",
        "business_profile_centroid_policy": "Primary movement plots show actual fitted centres and stable IDs; separate group-mean plots are descriptive summaries only.",
        "behavioural_label_semantics": "Profile-derived and cycle-specific; labels are not persistent cluster identities.",
        "geographic_segments": GEOGRAPHIC_SEGMENTS,
        "geographic_method": "Exact trailing90-day country commercial features: log customer count, sales, orders/customer, sales/customer, product diversity, repeat rate and five broad behavioural-family shares plus Other. Nine reporting categories are mapped back to five broad market families after removing centre qualifiers. Baseline RobustScaler then K-means K3 (n_init50, seed42); later markets use frozen nearest-centre prediction. Risk share is contextual, excluded from fitting.",
        "geographic_k_policy": "Cycle 0 geographic K=3 is a pre-specified descriptive market taxonomy, separate from behavioural K selection; this market count is not selected by the behavioural WCSS elbow.",
        "cycle_country_policy": "Cycle-level customer-to-market assignment uses each customer's most frequent distinct paid invoice country through the cycle snapshot; ties are resolved alphabetically. Customer.Country remains an all-history transaction-row mode and is not used for cycle-level market assignment.",
        "behavioural_cluster_mapping": artifacts.behavioural_cluster_mapping,
        "geographic_cluster_mapping": artifacts.geographic_cluster_mapping,
        "window_months": 3,
        "precomputed_cycles": [cycle.cycle_id for cycle in artifacts.cycle_definitions],
        "baseline_k_selection": "maximum-distance K-means WCSS elbow is the primary project decision rule; silhouette by candidate K is supporting evidence. For this run the elbow selects K=5 while silhouette peaks at K=2; the user-selected elbow-first rule determines K=5. This deliberately differs from the paper's initial minimum-Xie-Beni K selection.",
        "baseline_method": "Static K-means fit for Cycle 0 at the WCSS-elbow-selected K; customers have crisp, one-hot assignments. MDFCM is applied only in Cycles 1-9.",
        "cycle0_fcm_policy": "The earlier Cycle 0 FCM experiment is archive-only and permanently excluded from active preprocessing, model fitting, initialization, and future Cycle 0-9 outputs. Cycle 0 K-means centres initialize Cycle 1.",
        "feature_engineering": "Cycle RFM snapshots; log1p applied to Recency, Frequency, and Monetary; RF, RM, and FM are products of the corresponding logged values.",
        "scaling_and_reduction": "Fit MinMaxScaler and three-component PCA on Cycle 0 only; reuse both transforms in Cycles 1-9.",
        "frequency_monetary_period": "Exact trailing90days before each snapshot, divided by3 for monthly-equivalent rates; current-period commercial totals stored separately.",
        "recency_period": "exact days since last qualifying purchase, uncapped; >90 days Hibernating / Lost; risk is a separate deterioration/purchase-gap flag",
        "transaction_inclusion_policy": "Only positive-quantity, positive-unit-price, non-cancellation paid sales enter customer RFM, clustering, and business value summaries. Zero-price, negative-quantity, negative-price, and cancellation rows remain excluded from those model inputs and are documented in the cleaning audit.",
        "monetary_transformation": "log1p of positive paid sales; no return or cancellation subtraction",
        "monetary_sensitivity": "No net-versus-gross ranking sensitivity was fitted under the selected positive-sales-only policy. Return and cancellation summaries are audit-only.",
        "dynamic_method": "Study adaptation of Munusamy-Murugesan MDFCM in Cycles 1-9 only. Eq. 9 Condition 2 requires each incoming point to be farther from every prior centre than half that centre's farthest distinct-centre separation. Permitted candidates follow the published condition-dependent c-1/c/c+1 decision tree and are scored by Xie-Beni. The c movement option uses the incremental centre blend in Eqs. 14-16.",
        "dynamic_method_adaptations": "Every previously observed customer contributes exactly one current snapshot, including non-purchasers. Previous centres warm-start each update. Prior membership mass only represents prior customer IDs ABSENT from the incoming replacement snapshot; it is zero here because cumulative snapshots include every previous ID, avoiding double-counting overlapping observations. Conditions aggregate by any qualifying observation. Changed-K starts use each prior-centre elimination/principal-direction split then standard FCM. Only converged finite-XB candidates are eligible. m=2, objective-change tolerance0.01, maximum300 iterations. Full-replacement snapshots are a disclosed adaptation of the original incremental-new-object stream.",
        "inactive_customer_policy": "Non-purchasers remain in the full fitted snapshot with current rolling RFM and fresh fuzzy memberships. Activity_Status describes current-period commerce only; it never excludes a row from fitting or freezes historical assignments.",
        "cluster_identity_policy": "One-to-one minimum-cost matching by normalized centre distance and fuzzy-membership weighted Jaccard across shared customers, with dummy unmatched options; continue an ID only when weighted Jaccard >=0.05 and match cost is less than the combined retirement/creation cost; unmatched centres retire or receive a new provisional ID. The SQLite column CustomerOverlapJaccard is a legacy name for this weighted fuzzy score.",
        "dynamic_observation_adaptation": "One current trailing90-day observation per observed customer, replacing their prior snapshot; no duplicate historical membership mass.",
        "research_title": "Dynamic Customer Segmentation in Retail using Clustering",
        "firmographic_definition": "Firmographic customer-market segmentation operationalised through behavioural customer segments and geographic market segments.",
    }
    (model_directory / "model_metadata.json").write_text(
        json.dumps(model_metadata, indent=2), encoding="utf-8"
    )


def _sqlite_ready(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    for column in output.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
        output[column] = output[column].dt.strftime("%Y-%m-%d %H:%M:%S")
    output = output.replace([np.inf, -np.inf], np.nan)
    return output


def write_database(artifacts: PipelineArtifacts, database_path: Path) -> None:
    temporary_path = database_path.with_suffix(".corrected.tmp.db")
    if temporary_path.exists():
        temporary_path.unlink()

    preprocessing_columns = [
        "CustomerID",
        "CycleID",
        "Cycle_End_Date",
        "Window_Start_Date",
        "Frequency_Monetary_Period_Start",
        "Frequency_Monetary_Period_End",
        "Frequency_Monetary_Period_Months",
        "FirstPurchaseDate",
        "LatestPurchaseDate",
        "Activity_Status",
        "Lifecycle_Status",
        "Model_Profile_Name",
        "Is_New",
        "Recency",
        "Has_Purchase_In_Recency_Window",
        "Frequency",
        "Monetary",
        "Products",
        "Quantity",
        "Recency_Bucket",
        *RISK_COLUMNS,
        *SNAPSHOT_STATE_COLUMNS,
        *FEATURE_COLUMNS,
        *SCALED_FEATURE_COLUMNS,
        *PCA_COLUMNS,
    ]
    preprocessing = artifacts.preprocessing[preprocessing_columns].copy()
    preprocessing.insert(0, "PreprocessID", np.arange(1, len(preprocessing) + 1))

    baseline = artifacts.baseline_segmentation.copy()
    baseline.insert(0, "Cycle0_ID", np.arange(1, len(baseline) + 1))

    dynamic = artifacts.dynamic_results.copy()
    dynamic.insert(0, "DynamicID", np.arange(1, len(dynamic) + 1))
    silhouette_by_cycle = artifacts.cycle_summary.set_index("CycleID")["SilhouetteScore"]
    dynamic["Dynamic_Silhouette_Score"] = dynamic["CycleID"].map(silhouette_by_cycle)
    dynamic_table_columns = [
        "DynamicID",
        "CustomerID",
        "CycleID",
        "PreviousCycleID",
        "CurrentCycleID",
        "Previous_Cluster_Local_Index",
        "Previous_Stable_Cluster_ID",
        "Previous_Segment_Name",
        "MDFCM_Cluster_Number",
        "Cluster_Local_Index",
        "Stable_Cluster_ID",
        "Highest_Membership_Score",
        "All_Fuzzy_Memberships",
        "Fuzzy_Membership_Details",
        "Migration_Status",
        "Transition_Status",
        "Previous_Activity_Status",
        "Activity_Status",
        "Lifecycle_Status",
        "Assignment_Mode",
        "Model_Profile_Name",
        "Segment_Name",
        *RISK_COLUMNS,
        *SNAPSHOT_STATE_COLUMNS,
        "Updated_Centroids",
        "Dynamic_Silhouette_Score",
        "Fuzzy_Objective",
        "Xie_Beni_Index",
        "MDFCM_Condition_1_Met",
        "MDFCM_Condition_2_Met",
        "MDFCM_Condition_1_Count",
        "MDFCM_Condition_2_Count",
        "MDFCM_Decision",
        "MDFCM_Selected_K",
        "MDFCM_Candidate_XB",
        "MDFCM_Alpha",
        "MDFCM_Fuzziness",
        "MDFCM_Convergence_Tolerance",
        "MDFCM_Convergence_Criterion",
    ]
    dynamic_table = dynamic[dynamic_table_columns].copy()

    business = artifacts.business_analytics.copy()
    business_columns = [
        "InvoiceNo",
        "StockCode",
        "Description",
        "Quantity",
        "InvoiceDate",
        "UnitPrice",
        "CustomerID",
        "Country",
        "Stable_Cluster_ID",
        "Total_Price",
        "CycleID",
        "Revenue",
        "Segment_Name",
    ]
    business = business[business_columns]

    cycle_definitions = pd.DataFrame(
        [
            {
                "CycleID": cycle.cycle_id,
                "CycleNumber": cycle.cycle_number,
                "PeriodStart": cycle.period_start,
                "PeriodEnd": cycle.period_end,
                "WindowStart": cycle.window_start,
                "SnapshotDate": cycle.snapshot_date,
                "Phase": cycle.phase,
            }
            for cycle in artifacts.cycle_definitions
        ]
    )

    tables = {
        "Customer": artifacts.customer_master,
        "Cycle_Definitions": cycle_definitions,
        "Data_Preprocessing_Results": preprocessing,
        "Time_Cycle_0_Segmentation": baseline,
        "Cycle_0_Elbow_Results": artifacts.elbow_results,
        "Dynamic_Loop_Results": dynamic_table,
        "Customer_Transitions": artifacts.customer_transitions,
        "Dynamic_Centroids": artifacts.centroids,
        "Cluster_Lineage": artifacts.cluster_lineage,
        "Dynamic_Cycle_Summary": artifacts.cycle_summary,
        "MDFCM_Candidate_Evaluations": artifacts.mdfcm_candidate_evaluations,
        "Dynamic_Customer_Summary": artifacts.customer_summary,
        "Dynamic_Segment_Summary": artifacts.segment_summary,
        "Dynamic_Product_Summary": artifacts.product_summary,
        "Dynamic_Business_Analytics": business,
        "Geographic_Market_Features": artifacts.geographic_features,
        "Geographic_Segmentation": artifacts.geographic_segmentation,
        "Geographic_Cycle_Summary": artifacts.geographic_cycle_summary,
        "Firmographic_Customer_Segmentation": artifacts.firmographic_segmentation,
        "Model_Metadata": pd.DataFrame(
            [
                {
                    "MetadataKey": "ResearchTitle",
                    "MetadataValue": "Dynamic Customer Segmentation in Retail using Clustering",
                },
                {
                    "MetadataKey": "FirmographicDefinition",
                    "MetadataValue": "Firmographic customer-market segmentation operationalised through behavioural customer segments and geographic market segments.",
                },
                {"MetadataKey": "BehaviouralWindowMonths", "MetadataValue": "3"},
                {"MetadataKey": "AnalysisCycles", "MetadataValue": "Cycle_0 through Cycle_9"},
                {"MetadataKey": "Cycle0Method", "MetadataValue": "Static K-means at the WCSS-elbow-selected K; Cycle 0 stores crisp assignments and does not run FCM or MDFCM."},
                {"MetadataKey": "BaselineKSelection", "MetadataValue": "Normalized maximum-distance K-means WCSS elbow is primary; silhouette-by-K is supporting evidence. Current run selects K=5 at the elbow; silhouette peaks at K=2."},
                {"MetadataKey": "Cycle0FCMPolicy", "MetadataValue": "The earlier Cycle 0 FCM experiment is archive-only, permanently excluded from active processing and initialization. Cycle 0 K-means centres initialize Cycle 1."},
                {"MetadataKey": "DynamicMethod", "MetadataValue": "Study adaptation of MDFCM in Cycles 1-9 only; candidates follow the condition-dependent c-1/c/c+1 decision tree; c movement uses the incremental centre blend in Eqs. 14-16; converged finite candidates are compared by Xie-Beni."},
                {"MetadataKey": "MDFCMCondition2", "MetadataValue": "Corrected finite distinct-centre maximum (self-pairs excluded). Eq. 9 all-pairs rule: each incoming point must be farther than half the farthest distinct-centre separation from every prior centre."},
                {"MetadataKey": "MDFCMAlpha", "MetadataValue": "0.05"},
                {"MetadataKey": "MDFCMFuzzifier", "MetadataValue": "2"},
                {"MetadataKey": "MDFCMConvergenceTolerance", "MetadataValue": "absolute FCM objective change <= 0.01 (paper E_FCM; interpretation documented)"},
                {"MetadataKey": "PreprocessingSequence", "MetadataValue": "Missing/invalid cleaning and exact deduplication; cumulative customer snapshots and exact Recency; exact trailing90-day F/M normalized by3 for everycycle; current-period commerce separate; log1p R/F/M; pairwise cascaded RF/RM/FM products; Cycle 0 fitted MinMaxScaler; Cycle 0 fitted three-component PCA; static Cycle 0 K-means; MDFCM Cycles 1-9."},
                {"MetadataKey": "RollingWindowDays", "MetadataValue": "90"},
                {"MetadataKey": "FitPopulationPolicy", "MetadataValue": "All observed customers, one current replacement snapshot per ID, including non-purchasers; Is_Model_Fit=1"},
                {"MetadataKey": "SnapshotWeightingPolicy", "MetadataValue": "Historical membership mass is only for prior customer IDs absent from incoming snapshots; zero in this cumulative full-replacement run. Prior centres are warm starts."},
                {"MetadataKey": "ReportingLabelPolicy", "MetadataValue": LABEL_POLICY},
                {"MetadataKey": "CustomerRiskPolicy", "MetadataValue": RISK_POLICY},
                {"MetadataKey": "BusinessProfileCentroidPolicy", "MetadataValue": "Legacy business-profile means are contextual aggregates. The primary centroid_movement_cycles_0_9 figure and registry use actual K-means/MDFCM fitted centres and provisional tracking IDs, including all current fitted customers."},
                {"MetadataKey": "GeographicKPolicy", "MetadataValue": "Cycle 0 geographic K=3 is a pre-specified descriptive market taxonomy, separate from behavioural WCSS-elbow selection."},
                {"MetadataKey": "CycleCountryAssignmentPolicy", "MetadataValue": "Assign each customer to the most frequent distinct paid-invoice country through the cycle snapshot; alphabetical tie-break. Customer master country is all-history only."},
                {"MetadataKey": "ClusterIdentityPolicy", "MetadataValue": "Continue tracking ID only with fuzzy-membership weighted Jaccard >=0.05 across shared customers and combined normalized-centre/overlap cost <1 (less than retirement plus creation); otherwise retire/create provisional IDs. SQLite column CustomerOverlapJaccard retains its legacy name."},
                {"MetadataKey": "InactiveCustomerPolicy", "MetadataValue": "Every observed customer enters each current fit, including non-purchasers. Current snapshot replaces the prior observation for that ID. Activity_Status is commercial activity, not fitting eligibility; memberships are freshly updated."},
            ]
        ),
    }

    connection = sqlite3.connect(temporary_path)
    try:
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA synchronous=NORMAL")
        for table_name, frame in tables.items():
            _sqlite_ready(frame).to_sql(table_name, connection, if_exists="replace", index=False)
        indexes = [
            "CREATE UNIQUE INDEX idx_customer_id ON Customer(CustomerID)",
            "CREATE UNIQUE INDEX idx_cycle_definition ON Cycle_Definitions(CycleID)",
            "CREATE INDEX idx_preprocessing_customer_cycle ON Data_Preprocessing_Results(CustomerID, CycleID)",
            "CREATE INDEX idx_baseline_customer ON Time_Cycle_0_Segmentation(CustomerID)",
            "CREATE INDEX idx_dynamic_customer_cycle ON Dynamic_Loop_Results(CustomerID, CycleID)",
            "CREATE INDEX idx_transition_cycle_status ON Customer_Transitions(CycleID, Transition_Status)",
            "CREATE INDEX idx_customer_summary_cycle ON Dynamic_Customer_Summary(CycleID, CustomerID)",
            "CREATE INDEX idx_segment_summary_cycle ON Dynamic_Segment_Summary(CycleID, Segment_Name)",
            "CREATE INDEX idx_product_summary_cycle ON Dynamic_Product_Summary(CycleID, Segment_Name)",
            "CREATE INDEX idx_business_cycle_country ON Dynamic_Business_Analytics(CycleID, Country)",
            "CREATE INDEX idx_geo_cycle_country ON Geographic_Segmentation(CycleID, Country)",
            "CREATE INDEX idx_firmographic_cycle_customer ON Firmographic_Customer_Segmentation(CycleID, CustomerID)",
        ]
        for statement in indexes:
            connection.execute(statement)
        connection.commit()
        connection.execute("VACUUM")
    finally:
        connection.close()

    os.replace(temporary_path, database_path)


def _save_figure(path: Path) -> None:
    plt.tight_layout()
    plt.savefig(path, dpi=220, bbox_inches="tight", facecolor="white")
    plt.close()


def create_figures(artifacts: PipelineArtifacts, figure_directory: Path) -> None:
    sns.set_theme(style="whitegrid", font_scale=0.95)
    palette = {}

    baseline = artifacts.preprocessing.loc[
        artifacts.preprocessing["CycleID"].eq("Cycle_0")
    ].copy()
    plt.figure(figsize=(8, 6))
    plt.scatter(baseline["PC1"], baseline["PC2"], s=16, alpha=0.5, color="#555555")
    plt.title("Cycle 0 PCA projection before segmentation")
    plt.xlabel("Principal component 1")
    plt.ylabel("Principal component 2")
    _save_figure(figure_directory / "Baseline" / "cycle0_pca_unlabelled.png")

    figure = plt.figure(figsize=(9, 7))
    axis = figure.add_subplot(111, projection="3d")
    axis.scatter(baseline["PC1"], baseline["PC2"], baseline["PC3"], s=12, alpha=0.45, color="#444444")
    axis.set_title("Cycle 0 three-component PCA before segmentation")
    axis.set_xlabel("PC1")
    axis.set_ylabel("PC2")
    axis.set_zlabel("PC3")
    _save_figure(figure_directory / "Baseline" / "cycle0_pca_3d_unlabelled.png")

    plt.figure(figsize=(8, 5.5))
    plt.plot(artifacts.elbow_results["K"], artifacts.elbow_results["Inertia"], marker="o", color="#176b45")
    chosen_k = int(artifacts.baseline_segmentation["Optimal_K_Value"].iloc[0])
    plt.axvline(chosen_k, color="#222222", linestyle="--", label=f"Selected K = {chosen_k}")
    plt.title("Cycle 0 static K-means WCSS and elbow selection")
    plt.xlabel("Number of clusters (K)")
    plt.ylabel("Inertia / within-cluster sum of squares")
    plt.xticks(artifacts.elbow_results["K"].astype(int))
    plt.legend()
    _save_figure(figure_directory / "Baseline" / "cycle0_elbow_wcss.png")

    plt.figure(figsize=(8, 5.5))
    plt.plot(
        artifacts.elbow_results["K"],
        artifacts.elbow_results["Silhouette_Score"],
        marker="o",
        color="#376e9c",
    )
    plt.axvline(chosen_k, color="#222222", linestyle="--", label=f"Elbow-selected K = {chosen_k}")
    plt.title("Cycle 0 silhouette by candidate K")
    plt.xlabel("Number of clusters (K)")
    plt.ylabel("Mean silhouette score (higher is better)")
    plt.xticks(artifacts.elbow_results["K"].astype(int))
    plt.legend()
    _save_figure(figure_directory / "Baseline" / "cycle0_silhouette_by_k.png")

    cluster_names = sorted(
        set(baseline["Segment_Name"].dropna().unique())
        | set(artifacts.segment_summary["Segment_Name"].dropna().unique()),
        key=profile_sort_key,
    )
    palette = {name: profile_color(name) for name in cluster_names}
    plt.figure(figsize=(9, 6))
    for segment_name in sorted(baseline["Segment_Name"].dropna().unique(), key=profile_sort_key):
        group = baseline.loc[baseline["Segment_Name"].eq(segment_name)]
        plt.scatter(
            group["PC1"],
            group["PC2"],
            s=22,
            alpha=0.65,
            label=segment_name,
            color=palette.get(segment_name, profile_color(segment_name)),
        )
    plt.title("Cycle 0 behavioural customer clusters")
    plt.xlabel("Principal component 1")
    plt.ylabel("Principal component 2")
    plt.legend(frameon=True)
    _save_figure(figure_directory / "Baseline" / "cycle0_pca_clusters.png")

    fig, axes = plt.subplots(3, 2, figsize=(13, 12))
    for row_index, feature in enumerate(["Recency", "Frequency", "Monetary"]):
        sns.histplot(baseline[feature], bins=40, ax=axes[row_index, 0], color="#b4433f")
        sns.histplot(baseline[f"Log_{feature[0]}"], bins=40, ax=axes[row_index, 1], color="#087f5b")
        axes[row_index, 0].set_title(f"Raw {feature}")
        axes[row_index, 1].set_title(f"Log transformed {feature}")
    fig.suptitle("Cycle 0 RFM distributions before and after log transformation", y=1.01)
    _save_figure(figure_directory / "Baseline" / "rfm_log_transformation.png")

    baseline_counts = artifacts.baseline_segmentation.groupby("Segment_Name").size().rename("Customers").reset_index()
    baseline_counts["CycleID"] = "Cycle_0"
    evolution = pd.concat(
        [
            baseline_counts[["CycleID", "Segment_Name", "Customers"]],
            artifacts.segment_summary[["CycleID", "Segment_Name", "Customers"]],
        ],
        ignore_index=True,
    )
    # A family can occur under multiple stable tracking IDs. Combine those
    # rows before drawing the customer-facing family trend so each cycle has
    # one point per displayed family.
    evolution = evolution.groupby(
        ["CycleID", "Segment_Name"], as_index=False, dropna=False
    )["Customers"].sum()
    evolution["CycleNumber"] = evolution["CycleID"].str.replace("Cycle_", "", regex=False).astype(int)
    plt.figure(figsize=(11, 6))
    for segment_name in sorted(evolution["Segment_Name"].dropna().unique(), key=profile_sort_key):
        group = evolution.loc[evolution["Segment_Name"].eq(segment_name)]
        group = group.sort_values("CycleNumber")
        plt.plot(
            group["CycleNumber"],
            group["Customers"],
            marker="o",
            linewidth=2.2,
            label=segment_name,
            color=palette.get(segment_name, profile_color(segment_name)),
        )
    plt.title("Behavioural segment evolution from Cycle 0 to Cycle 9")
    plt.xlabel("Cycle")
    plt.ylabel("Customers")
    plt.xticks(range(0, 10))
    plt.legend()
    _save_figure(figure_directory / "Dynamic" / "segment_evolution_cycles_0_9.png")

    transitions = artifacts.customer_transitions.groupby(
        ["CycleID", "Transition_Status"]
    ).size().rename("Customers").reset_index()
    transitions["CycleNumber"] = transitions["CycleID"].str.replace("Cycle_", "", regex=False).astype(int)
    transition_pivot = transitions.pivot(
        index="CycleNumber", columns="Transition_Status", values="Customers"
    ).fillna(0)
    transition_order = [
        "New",
        "Existing Stable",
        "Existing Migrated",
    ]
    transition_pivot = transition_pivot.reindex(columns=transition_order, fill_value=0)
    transition_pivot.plot(
        kind="bar",
        stacked=True,
        figsize=(12, 6),
        color=["#9bd3ae", "#0b7a4b", "#e0a72f"],
    )
    plt.title("Customer fitted assignment states")
    plt.xlabel("Cycle")
    plt.ylabel("Customers")
    plt.legend(title="Transition state", ncol=3)
    _save_figure(figure_directory / "Dynamic" / "customer_transition_states.png")

    plt.figure(figsize=(10, 5.5))
    cycle_numbers = artifacts.cycle_summary["CycleID"].str.replace("Cycle_", "", regex=False).astype(int)
    plt.plot(
        cycle_numbers,
        artifacts.cycle_summary["XieBeniIndex"],
        color="#006b3c",
        marker="o",
        linewidth=2.4,
    )
    plt.title("Xie-Beni index across dynamic cycles")
    plt.xlabel("Cycle")
    plt.ylabel("Xie-Beni index, lower is better")
    plt.xticks(range(1, 10))
    _save_figure(figure_directory / "Validation" / "xie_beni_index.png")

    fig, axes = plt.subplots(2, 3, figsize=(15, 8), constrained_layout=True)
    validity_series = [
        ("SilhouetteScore", "Silhouette (higher is better)", "#006b3c"),
        ("DaviesBouldinScore", "Davies–Bouldin (lower is better)", "#d08a27"),
        ("CalinskiHarabaszScore", "Calinski–Harabasz (higher is better)", "#377dc1"),
        ("XieBeniIndex", "Xie–Beni (lower is better)", "#855eb0"),
        ("AverageMembership", "Mean maximum membership", "#2a9d5b"),
        ("MigrationRate", "Comparable customer migration (%)", "#d9a62e"),
    ]
    for axis, (column, title, color) in zip(axes.flat, validity_series):
        axis.plot(cycle_numbers, artifacts.cycle_summary[column], marker="o", color=color, linewidth=2)
        axis.set_title(title)
        axis.set_xlabel("Cycle")
        axis.set_xticks(range(1, 10))
        axis.grid(True, alpha=0.3)
    fig.suptitle("Dynamic MDFCM validity and customer-movement diagnostics", fontsize=14)
    _save_figure(figure_directory / "Validation" / "dynamic_model_quality.png")

    latest_geo = artifacts.geographic_segmentation.loc[
        artifacts.geographic_segmentation["CycleID"].eq("Cycle_9")
    ].sort_values("Revenue", ascending=True)
    plt.figure(figsize=(10, 9))
    geo_colors = {
        "Largest Revenue Market": "#0d6f48",
        "Highest Revenue-per-Customer Market": "#2469a5",
        "Other Markets": "#bb7925",
    }
    plt.barh(
        latest_geo["Country"],
        latest_geo["Revenue"],
        color=latest_geo["Geographic_Segment_Name"].map(geo_colors),
    )
    plt.title("Cycle 9 geographic market segmentation")
    plt.xlabel("Three-month rolling revenue")
    plt.ylabel("Country market")
    _save_figure(figure_directory / "Geographic" / "cycle9_market_segments.png")

    geographic_counts = artifacts.geographic_segmentation.groupby(
        ["CycleID", "Geographic_Segment_Name"]
    ).size().rename("Markets").reset_index()
    geographic_counts["CycleNumber"] = geographic_counts["CycleID"].str.replace(
        "Cycle_", "", regex=False
    ).astype(int)
    plt.figure(figsize=(11, 6))
    for segment_name, group in geographic_counts.groupby("Geographic_Segment_Name"):
        group = group.sort_values("CycleNumber")
        plt.plot(
            group["CycleNumber"],
            group["Markets"],
            marker="o",
            label=segment_name,
            color=geo_colors[segment_name],
        )
    plt.title("Geographic market segments from Cycle 0 to Cycle 9")
    plt.xlabel("Cycle")
    plt.ylabel("Country markets")
    plt.xticks(range(0, 10))
    plt.legend()
    _save_figure(figure_directory / "Geographic" / "market_segment_evolution.png")

    latest_firmographic = artifacts.firmographic_segmentation.loc[
        artifacts.firmographic_segmentation["CycleID"].eq("Cycle_9")
    ]
    top_firmographic = (
        latest_firmographic.groupby("Firmographic_Segment_Name")
        .size()
        .sort_values(ascending=False)
        .head(16)
        .sort_values()
    )
    plt.figure(figsize=(11, 7))
    plt.barh(top_firmographic.index, top_firmographic.values, color="#178f5d")
    plt.title("Cycle 9 firmographic customer-market segments")
    plt.xlabel("Customers")
    plt.ylabel("Firmographic segment")
    _save_figure(figure_directory / "Firmographic" / "cycle9_firmographic_segments.png")


def validate_artifacts(artifacts: PipelineArtifacts) -> dict[str, Any]:
    expected_cycles = {f"Cycle_{number}" for number in range(10)}
    actual_cycles = set(artifacts.preprocessing["CycleID"].unique())
    if actual_cycles != expected_cycles:
        raise AssertionError(f"Unexpected preprocessing cycles: {sorted(actual_cycles)}")

    customer_counts = (
        artifacts.preprocessing.groupby("CycleID")["CustomerID"]
        .nunique()
        .rename_axis("CycleID")
        .reset_index(name="Customers")
    )
    customer_counts["CycleNumber"] = customer_counts["CycleID"].str.replace(
        "Cycle_", "", regex=False
    ).astype(int)
    ordered_counts = customer_counts.sort_values("CycleNumber")["Customers"].to_numpy()
    if np.any(np.diff(ordered_counts) < 0):
        raise AssertionError("The cumulative customer population decreases between cycles")
    if artifacts.preprocessing["Recency"].min() < 0 or artifacts.preprocessing["Recency"].max() > 366:
        raise AssertionError("Exact days-since-purchase values are outside the study date span")
    for table in [artifacts.baseline_segmentation, artifacts.dynamic_results, artifacts.customer_summary, artifacts.firmographic_segmentation]:
        if not table["Segment_Name"].map(base_profile).isin(PROFILE_ORDER).all():
            raise AssertionError("An unknown descriptive cluster label was emitted")
        if not table["Is_Model_Fit"].eq(1).all():
            raise AssertionError("An observed customer was excluded from current fitting")
    first_dynamic = artifacts.dynamic_results.loc[artifacts.dynamic_results["CycleID"].eq("Cycle_1")]
    if first_dynamic["Membership_Change"].notna().any():
        raise AssertionError("Cycle 0 crisp-to-fuzzy comparisons must be excluded")
    dynamic_latest = artifacts.dynamic_results.loc[artifacts.dynamic_results["CycleID"].eq("Cycle_9")]
    for cycle_id,current in artifacts.dynamic_results.groupby("CycleID"):
        if current["CustomerID"].duplicated().any() or not current["Assignment_Mode"].eq("Current-cycle fuzzy fit").all():
            raise AssertionError(f"{cycle_id} does not update every observed customer exactly once")
        selected=int(artifacts.cycle_summary.set_index("CycleID").loc[cycle_id,"SelectedK"])
        if not current["All_Fuzzy_Memberships"].map(lambda text:len(json.loads(text))==selected).all():
            raise AssertionError(f"{cycle_id} has frozen historical or wrong-dimension vectors")
    if not artifacts.cycle_summary["HistoricalMembershipMassUsed"].eq(0).all():
        raise AssertionError("Repeated full snapshots must not add prior membership mass to the incoming observation population")
    observed_transitions = set(artifacts.customer_transitions["Transition_Status"].unique())
    if not observed_transitions:
        raise AssertionError("Customer transition results are empty")
    if artifacts.cycle_summary["XieBeniIndex"].isna().any():
        raise AssertionError("Xie-Beni index contains missing values")
    if not artifacts.cycle_summary["XieBeniIndex"].gt(0).all():
        raise AssertionError("Xie-Beni index must be positive")
    candidate_audit = artifacts.mdfcm_candidate_evaluations
    if candidate_audit.empty or candidate_audit["Converged"].ne(1).any():
        raise AssertionError("Every evaluated MDFCM candidate must converge before comparison")
    if candidate_audit["FinalObjectiveChange"].gt(candidate_audit["ConvergenceTolerance"] + 1e-12).any():
        raise AssertionError("An MDFCM candidate stopped before reaching the objective-change tolerance")
    if candidate_audit.groupby("CycleID")["Selected"].sum().ne(1).any():
        raise AssertionError("Each dynamic cycle must identify exactly one selected MDFCM candidate")
    centroids_by_cycle = artifacts.centroids.groupby("CycleID").size().to_dict()
    previous_k = int(artifacts.baseline_segmentation["Optimal_K_Value"].iloc[0])
    for cycle_row in artifacts.cycle_summary.sort_values("CycleID", key=lambda values: values.str.replace("Cycle_", "", regex=False).astype(int)).to_dict("records"):
        candidate_scores = json.loads(cycle_row["CandidateXB"])
        condition_1 = int(cycle_row["Condition1ObservationCount"]) > 0
        condition_2 = int(cycle_row["Condition2ObservationCount"]) > 0
        if condition_1 and condition_2:
            expected_candidates = {previous_k - 1, previous_k, previous_k + 1}
        elif condition_1:
            expected_candidates = {previous_k - 1, previous_k + 1}
        elif condition_2:
            expected_candidates = {previous_k, previous_k + 1}
        else:
            expected_candidates = {previous_k}
        expected_candidates = {candidate for candidate in expected_candidates if candidate >= 2}
        if {int(candidate) for candidate in candidate_scores} != expected_candidates:
            raise AssertionError(f"{cycle_row['CycleID']} candidate set does not follow the MDFCM condition decision")
        selected_candidate = min(candidate_scores, key=lambda candidate: candidate_scores[candidate])
        if int(selected_candidate) != int(cycle_row["SelectedK"]):
            raise AssertionError(f"{cycle_row['CycleID']} did not select the minimum-XB candidate")
        chosen = candidate_audit.loc[
            candidate_audit["CycleID"].eq(cycle_row["CycleID"])
            & candidate_audit["Selected"].eq(1)
        ].iloc[0]
        expected_action = (
            "eliminate_one_cluster" if int(cycle_row["SelectedK"]) < previous_k
            else "split_one_cluster" if int(cycle_row["SelectedK"]) > previous_k
            else "incremental_center_movement"
        )
        if chosen["InitializationAction"] != expected_action:
            raise AssertionError(f"{cycle_row['CycleID']} selected K and recorded structural operation disagree")
        if centroids_by_cycle.get(cycle_row["CycleID"]) != int(cycle_row["SelectedK"]):
            raise AssertionError(f"{cycle_row['CycleID']} centroid count does not match selected K")
        previous_k = int(cycle_row["SelectedK"])

    primary_lineage = artifacts.cluster_lineage.loc[artifacts.cluster_lineage["IsPrimaryMatch"].eq(1)]
    if primary_lineage["CustomerOverlapJaccard"].isna().any() or primary_lineage["CustomerOverlapJaccard"].lt(MIN_LINEAGE_JACCARD).any():
        raise AssertionError("A primary centroid tracking link does not meet the overlap threshold")
    if primary_lineage["MatchCost"].isna().any() or primary_lineage["MatchCost"].ge(1.0).any():
        raise AssertionError("A primary centroid link costs at least as much as a retirement and creation")
    active_assignments = artifacts.dynamic_results.loc[artifacts.dynamic_results["Is_Model_Fit"].eq(1)]
    soft_membership_mass: dict[str, list[float]] = {}
    hard_winner_gaps: dict[str, int] = {}
    selected_k_by_cycle = artifacts.cycle_summary.set_index("CycleID")["SelectedK"]
    for cycle_id, customers in active_assignments.groupby("CycleID"):
        matrix = np.vstack(customers["All_Fuzzy_Memberships"].map(json.loads).to_numpy())
        expected_k = int(selected_k_by_cycle.loc[cycle_id])
        if matrix.shape[1] != expected_k:
            raise AssertionError(f"{cycle_id} membership vectors do not match selected K")
        if not np.isfinite(matrix).all() or (matrix < -1e-12).any():
            raise AssertionError(f"{cycle_id} has invalid fuzzy memberships")
        if not np.allclose(matrix.sum(axis=1), 1.0, atol=1e-8):
            raise AssertionError(f"{cycle_id} fuzzy memberships do not sum to one")
        cluster_mass = matrix.sum(axis=0)
        if (cluster_mass <= 1e-12).any():
            raise AssertionError(f"{cycle_id} contains a fitted centre with no fuzzy membership mass")
        soft_membership_mass[cycle_id] = [float(value) for value in cluster_mass]
        hard_winner_gaps[cycle_id] = int((np.bincount(matrix.argmax(axis=1), minlength=expected_k) == 0).sum())
    stable_ids_per_local = active_assignments.groupby(
        ["CycleID", "Cluster_Local_Index"]
    )["Stable_Cluster_ID"].nunique()
    if stable_ids_per_local.ne(1).any():
        raise AssertionError("A fitted local centroid maps to more than one stable tracking ID")
    if set(artifacts.geographic_segmentation["CycleID"].unique()) != expected_cycles:
        raise AssertionError("Geographic segmentation does not cover all cycles")
    if artifacts.geographic_segmentation["Geographic_Segment_Name"].nunique() != 3:
        raise AssertionError("The geographic model did not produce three market segments")
    if set(artifacts.firmographic_segmentation["CycleID"].unique()) != expected_cycles:
        raise AssertionError("Firmographic customer-market results do not cover Cycle 0-9")
    if artifacts.baseline_segmentation["Optimal_K_Value"].nunique() != 1:
        raise AssertionError("Cycle 0 baseline must have one selected K")
    selected_k = int(artifacts.baseline_segmentation["Optimal_K_Value"].iloc[0])
    if artifacts.baseline_segmentation["KMeans_Cluster_Number"].nunique() != selected_k:
        raise AssertionError("Cycle 0 K-means cluster count does not match elbow-selected K")
    membership_vectors = artifacts.baseline_segmentation["All_Fuzzy_Memberships"].map(json.loads)
    if not membership_vectors.map(lambda row: abs(sum(row) - 1.0) <= 1e-6).all():
        raise AssertionError("Cycle 0 one-hot K-means assignment vectors must sum to one")
    if not membership_vectors.map(lambda row: sum(value == 1.0 for value in row) == 1 and all(value in {0.0, 1.0} for value in row)).all():
        raise AssertionError("Cycle 0 K-means assignments must be crisp one-hot vectors")
    if any(cycle_id == "Cycle_10" for cycle_id in actual_cycles):
        raise AssertionError("Cycle 10 must be excluded from repaired model outputs")

    return {
        "clean_transactions": int(len(artifacts.transactions)),
        "customers": int(artifacts.customer_master["CustomerID"].nunique()),
        "cycles": len(expected_cycles),
        "cycle_0_selected_k": selected_k,
        "maximum_recency_days": int(artifacts.preprocessing["Recency"].max()),
        "hibernating_cycle_9": int(dynamic_latest["Recency"].gt(90).sum()),
        "cycle_0_silhouette_candidates": int(artifacts.elbow_results["Silhouette_Score"].notna().sum()),
        "inactive_records": int(artifacts.preprocessing["Activity_Status"].eq("Inactive").sum()),
        "geographic_markets_cycle_9": int(artifacts.geographic_segmentation.loc[
            artifacts.geographic_segmentation["CycleID"].eq("Cycle_9"), "Country"
        ].nunique()),
        "firmographic_segments_cycle_9": int(artifacts.firmographic_segmentation.loc[
            artifacts.firmographic_segmentation["CycleID"].eq("Cycle_9"), "Firmographic_Segment_Name"
        ].nunique()),
        "mean_migration_rate": float(artifacts.cycle_summary["MigrationRate"].mean()),
        "mean_xie_beni": float(artifacts.cycle_summary["XieBeniIndex"].mean()),
        "dynamic_soft_membership_mass_by_cycle": soft_membership_mass,
        "dynamic_clusters_without_hard_winner_by_cycle": hard_winner_gaps,
    }


def rebuild_model(model_directory: Path) -> dict[str, Any]:
    model_directory = model_directory.resolve()
    source_path = model_directory / "Online UK_Retail.xlsx"
    if not source_path.exists():
        raise FileNotFoundError(source_path)

    output_root = model_directory / "repair_outputs_2026-10-23"
    output_root.mkdir(parents=True, exist_ok=True)
    run_directory = output_root / f"run_{time.strftime('%Y%m%d_%H%M%S')}"
    run_directory.mkdir(parents=False, exist_ok=False)
    database_path = run_directory / "csrs_pipeline_b_repaired.db"
    artifacts = run_pipeline(source_path)
    validation_summary = validate_artifacts(artifacts)
    figure_directory = prepare_figure_directories(run_directory)
    save_models(artifacts, run_directory)
    create_figures(artifacts, figure_directory)
    write_database(artifacts, database_path)
    from cluster_reporting import install_current_reporting
    install_current_reporting(run_directory)
    from refresh_segment_figures import refresh_all_figures
    with sqlite3.connect(database_path) as figure_connection:
        validation_summary.update(refresh_all_figures(figure_connection, figure_directory))
    from audit_semantic_migration import audit as audit_semantic_migration
    semantic_report = audit_semantic_migration(run_directory)
    validation_summary["semantic_profile_checks"] = semantic_report["totals"]["profileChecks"]
    from audit_population_quality import audit as audit_population_quality
    audit_population_quality(run_directory)
    from refresh_methodology_diagram import create_diagram
    create_diagram(figure_directory)
    from export_evaluation_figures import export as export_evaluation_figures
    export_evaluation_figures(run_directory)
    validation_summary["database_path"] = str(database_path)
    validation_summary["figure_directory"] = str(figure_directory)
    validation_summary["output_directory"] = str(run_directory)
    (run_directory / "model_validation_summary.json").write_text(
        json.dumps(validation_summary, indent=2), encoding="utf-8"
    )
    return validation_summary
