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
    2: "Broader, Higher-Repeat Market",
    3: "Smaller Market",
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
PROFILE_ORDER = [
    "Champions",
    "Champions At Risk",
    "Loyalists",
    "Loyalists At Risk",
    "Mid-Tier Occasionals",
    "Mid-Tier Occasionals At Risk",
    "Developing",
    "Developing At Risk",
    "Hibernating / Lost",
]
PROFILE_COLORS = {
    "Champions": "#168a58",
    "Champions At Risk": "#0b5e3d",
    "Loyalists": "#377dc1",
    "Loyalists At Risk": "#245a8d",
    "Mid-Tier Occasionals": "#e69f00",
    "Mid-Tier Occasionals At Risk": "#a96700",
    "Developing": "#56b4e9",
    "Developing At Risk": "#287da8",
    "Hibernating / Lost": "#667085",
}


def profile_color(name: str) -> str:
    return PROFILE_COLORS.get(str(name or ""), "#9a9a9a")


def profile_sort_key(name: str) -> tuple[int, str]:
    text = str(name or "")
    try:
        return PROFILE_ORDER.index(text), text
    except ValueError:
        return len(PROFILE_ORDER), text
GEOGRAPHIC_FEATURE_COLUMNS = [
    "Log_Customer_Count",
    "Log_Revenue",
    "Log_Orders_Per_Customer",
    "Log_Revenue_Per_Customer",
    "Log_Product_Diversity",
    "Repeat_Purchase_Rate",
    "Champions_Share",
    "Champions_At_Risk_Share",
    "Loyalists_Share",
    "Loyalists_At_Risk_Share",
    "Mid_Tier_Occasionals_Share",
    "Mid_Tier_Occasionals_At_Risk_Share",
    "Developing_Share",
    "Developing_At_Risk_Share",
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
    transactions["InvoiceNo"] = transactions["InvoiceNo"].astype(str).str.strip()
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

    transactions = transactions.loc[
        transactions["CustomerID"].notna()
        & transactions["InvoiceDate"].notna()
        & transactions["InvoiceDate"].ge(pd.Timestamp("2010-12-01"))
        & transactions["InvoiceDate"].lt(pd.Timestamp("2011-12-01"))
        & transactions["UnitPrice"].gt(0)
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
        window_start = snapshot_date - pd.DateOffset(months=3)
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
    history = transactions.loc[transactions["InvoiceDate"] < cycle.snapshot_date]
    historical_purchases = history.loc[history["Purchase_InvoiceNo"].notna()]
    recency_window = historical_purchases.loc[
        historical_purchases["InvoiceDate"] >= cycle.window_start
    ]
    cycle_period = transactions.loc[
        transactions["InvoiceDate"].ge(cycle.period_start)
        & transactions["InvoiceDate"].lt(cycle.period_end)
    ]
    cycle_purchases = cycle_period.loc[cycle_period["Purchase_InvoiceNo"].notna()]
    eligible_customers = customer_master.loc[
        customer_master["FirstPurchaseDate"] < cycle.snapshot_date
    ].copy()

    latest_purchase = historical_purchases.groupby("CustomerID")["InvoiceDate"].max()
    frequency = cycle_purchases.groupby("CustomerID")["Purchase_InvoiceNo"].nunique()
    monetary = cycle_period.groupby("CustomerID")["Total_Price"].sum()
    gross_monetary = cycle_purchases.groupby("CustomerID")["Total_Price"].sum()
    products = cycle_purchases.groupby("CustomerID")["Description"].nunique()
    quantity = cycle_period.groupby("CustomerID")["Quantity"].sum()
    period_months = max(
        (cycle.period_end.year - cycle.period_start.year) * 12
        + cycle.period_end.month - cycle.period_start.month,
        1,
    )
    aggregates = pd.DataFrame(
        {
            "Frequency": frequency,
            "Monetary": monetary,
            "Gross_Monetary": gross_monetary,
            "Products": products,
            "Quantity": quantity,
        }
    )
    aggregates[["Frequency", "Monetary", "Gross_Monetary", "Products", "Quantity"]] = aggregates[
        ["Frequency", "Monetary", "Gross_Monetary", "Products", "Quantity"]
    ].div(period_months)
    snapshot = eligible_customers.set_index("CustomerID")
    snapshot["LatestPurchaseDate"] = latest_purchase.reindex(snapshot.index)
    snapshot = snapshot.join(aggregates, how="left")
    snapshot[["Frequency", "Monetary", "Gross_Monetary", "Products", "Quantity"]] = snapshot[
        ["Frequency", "Monetary", "Gross_Monetary", "Products", "Quantity"]
    ].fillna(0)
    snapshot["Frequency"] = snapshot["Frequency"].astype(float)
    snapshot["Products"] = snapshot["Products"].astype(float)
    snapshot["Quantity"] = snapshot["Quantity"].astype(float)
    snapshot["Monetary"] = snapshot["Monetary"].astype(float)
    snapshot["Gross_Monetary"] = snapshot["Gross_Monetary"].astype(float)
    snapshot["Net_Monetary_Rank_Percentile"] = snapshot["Monetary"].rank(pct=True)
    snapshot["Gross_Monetary_Rank_Percentile"] = snapshot["Gross_Monetary"].rank(pct=True)
    # Customer Monetary is now defined from positive paid sales only. The
    # retained Gross_Monetary alias therefore equals the primary measure; the
    # matched-return sensitivity remains in the separate cleaning audit.
    snapshot["Monetary_Rank_Quartile_Changed"] = 0
    snapshot["Net_Gross_Monetary_Rank_Correlation"] = 1.0
    snapshot["Has_Purchase_In_Recency_Window"] = (
        snapshot["LatestPurchaseDate"].ge(cycle.window_start).fillna(False).astype("int64")
    )
    observed_recency = (
        cycle.snapshot_date.normalize() - snapshot["LatestPurchaseDate"].dt.normalize()
    ).dt.days
    # Keep exact days-since-purchase so customers can cross the explicit >90-day
    # Hibernating / Lost boundary instead of being hidden by a capped sentinel.
    snapshot["Recency"] = observed_recency.fillna(
        (cycle.snapshot_date.normalize() - customer_master["FirstPurchaseDate"].min().normalize()).days + 1
    ).astype("int64")
    snapshot["Lifecycle_Status"] = np.where(
        snapshot["Recency"].gt(90), "Hibernating / Lost", "Within 90-day window"
    )
    snapshot["Activity_Status"] = np.where(snapshot["Frequency"].gt(0), "Active", "Inactive")
    snapshot["Is_New"] = (
        snapshot["FirstPurchaseDate"].ge(cycle.period_start)
        & snapshot["FirstPurchaseDate"].lt(cycle.period_end)
    ).astype("int64")
    snapshot["Recency_Bucket"] = pd.cut(
        snapshot["Recency"],
        bins=[-1, 30, 60, 90, np.inf],
        labels=["0-30 days: recent", "31-60 days: at risk", "61-90 days: high risk", "91+ days: hibernating/lost"],
    ).astype(str)

    snapshot["Log_R"] = np.log1p(snapshot["Recency"].clip(lower=0))
    snapshot["Log_F"] = np.log1p(snapshot["Frequency"].clip(lower=0))
    snapshot["Log_M"] = np.log1p(snapshot["Monetary"].clip(lower=0))
    snapshot["RF_Score"] = snapshot["Log_R"] * snapshot["Log_F"]
    snapshot["RM_Score"] = snapshot["Log_R"] * snapshot["Log_M"]
    snapshot["FM_Score"] = snapshot["Log_F"] * snapshot["Log_M"]
    snapshot["CycleID"] = cycle.cycle_id
    snapshot["Cycle_End_Date"] = cycle.snapshot_date
    snapshot["Window_Start_Date"] = cycle.window_start
    snapshot["Frequency_Monetary_Period_Start"] = cycle.period_start
    snapshot["Frequency_Monetary_Period_End"] = cycle.period_end
    snapshot["Frequency_Monetary_Period_Months"] = period_months
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


def name_rfm_clusters(snapshot: pd.DataFrame, labels: np.ndarray) -> dict[int, str]:
    """Map numeric clusters to a small, ordered business-facing RFM hierarchy."""
    profiles = snapshot.assign(_Cluster=labels).groupby("_Cluster").agg(
        Recency=("Recency", "mean"),
        Frequency=("Frequency", "mean"),
        Monetary=("Monetary", "mean"),
    )
    if profiles.empty:
        return {}
    r_score = profiles["Recency"].rank(pct=True, ascending=False)
    f_score = profiles["Frequency"].rank(pct=True)
    m_score = profiles["Monetary"].rank(pct=True)
    value_score = 0.25 * r_score + 0.40 * f_score + 0.35 * m_score
    ordered = value_score.sort_values(ascending=False).index.tolist()
    names: dict[int, str] = {}
    if not ordered:
        return names
    names[int(ordered[0])] = "Champions"
    if len(ordered) == 1:
        return names
    remaining = ordered[1:]
    loyalist = max(
        remaining,
        key=lambda cluster: 0.65 * f_score.loc[cluster] + 0.35 * r_score.loc[cluster],
    )
    names[int(loyalist)] = "Loyalists"
    remaining = [cluster for cluster in remaining if cluster != loyalist]
    if remaining:
        midtier = max(
            remaining,
            key=lambda cluster: 0.55 * f_score.loc[cluster] + 0.45 * m_score.loc[cluster],
        )
        names[int(midtier)] = "Mid-Tier Occasionals"
        remaining = [cluster for cluster in remaining if cluster != midtier]
    for cluster in remaining:
        names[int(cluster)] = "Developing"
    return names


def match_cluster_ids(
    previous_centroids: np.ndarray,
    previous_state: pd.DataFrame,
    current_centroids: np.ndarray,
    current_customer_ids: pd.Series,
    current_labels: np.ndarray,
    next_cluster_number: int,
    cycle_id: str,
) -> tuple[dict[int, str], int, pd.DataFrame]:
    """Assign best-fit cross-cycle tracking IDs from centre distance and overlap.

    The assignment is currently forced one-to-one for as many clusters as possible;
    it is a tracking convention and does not validate persistent real-world identity.
    """
    previous_k, current_k = len(previous_centroids), len(current_centroids)
    distances = np.sqrt(
        np.sum((previous_centroids[:, None, :] - current_centroids[None, :, :]) ** 2, axis=2)
    )
    positive_distances = distances[distances > 1e-12]
    distance_scale = float(np.median(positive_distances)) if len(positive_distances) else 1.0
    normalized_distances = distances / max(distance_scale, 1e-12)

    current = pd.DataFrame(
        {"CustomerID": current_customer_ids.to_numpy(), "CurrentLocalCluster": current_labels}
    )
    shared = previous_state[
        ["CustomerID", "Cluster_Local_Index", "Stable_Cluster_ID"]
    ].merge(current, on="CustomerID", how="inner")
    intersections = np.zeros((previous_k, current_k), dtype=float)
    if not shared.empty:
        counts = pd.crosstab(shared["Cluster_Local_Index"], shared["CurrentLocalCluster"])
        for previous_index in range(previous_k):
            for current_index in range(current_k):
                intersections[previous_index, current_index] = float(
                    counts.get(current_index, pd.Series(dtype=float)).get(previous_index, 0)
                )
        previous_sizes = shared.groupby("Cluster_Local_Index").size().reindex(
            range(previous_k), fill_value=0
        ).to_numpy(dtype=float)
        current_sizes = shared.groupby("CurrentLocalCluster").size().reindex(
            range(current_k), fill_value=0
        ).to_numpy(dtype=float)
    else:
        previous_sizes = np.zeros(previous_k, dtype=float)
        current_sizes = np.zeros(current_k, dtype=float)
    union = previous_sizes[:, None] + current_sizes[None, :] - intersections
    overlap = np.divide(intersections, union, out=np.zeros_like(intersections), where=union > 0)
    cost = 0.5 * normalized_distances + 0.5 * (1.0 - overlap)
    matched_previous, matched_current = linear_sum_assignment(cost)
    previous_ids = (
        previous_state.drop_duplicates("Cluster_Local_Index")
        .set_index("Cluster_Local_Index")["Stable_Cluster_ID"]
        .to_dict()
    )
    stable_by_current: dict[int, str] = {}
    primary_pairs: dict[int, int] = {}
    for previous_index, current_index in zip(matched_previous, matched_current):
        stable_by_current[int(current_index)] = str(previous_ids[int(previous_index)])
        primary_pairs[int(current_index)] = int(previous_index)
    for current_index in range(current_k):
        if current_index not in stable_by_current:
            stable_by_current[current_index] = f"CL-{next_cluster_number:03d}"
            next_cluster_number += 1

    previous_overlap_degree = (overlap >= 0.05).sum(axis=1)
    current_overlap_degree = (overlap >= 0.05).sum(axis=0)
    lineage: list[dict[str, Any]] = []
    matched_prev_set = set(int(value) for value in matched_previous)
    matched_current_set = set(int(value) for value in matched_current)
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
            if (previous_index, current_index) in {
                (old, new) for new, old in primary_pairs.items()
            } or overlap[previous_index, current_index] < 0.05:
                continue
            event = (
                "split contribution" if previous_overlap_degree[previous_index] > 1
                else "merge contribution" if current_overlap_degree[current_index] > 1
                else "secondary overlap"
            )
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
    distance_squared = np.sum((features[:, None, :] - centroids[None, :, :]) ** 2, axis=2)
    distances = np.sqrt(np.maximum(distance_squared, 1e-12))
    exponent = 2.0 / (fuzziness - 1.0)
    inverse = np.power(distances, -exponent)
    memberships = inverse / inverse.sum(axis=1, keepdims=True)
    exact_rows = np.where(distance_squared.min(axis=1) <= 1e-12)[0]
    if len(exact_rows):
        memberships[exact_rows] = 0.0
        memberships[exact_rows, distance_squared[exact_rows].argmin(axis=1)] = 1.0
    return memberships, distance_squared


def dynamic_fuzzy_update(
    features: np.ndarray,
    previous_centroids: np.ndarray,
    fuzziness: float = 2.0,
    alpha: float = 0.05,
    maximum_iterations: int = 300,
    tolerance: float = 0.01,
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
        np.fill_diagonal(center_distances, 0.0)
        # Equation (9) checks each update against every existing center pair.
        # For each center, the strictest pair bound is half its farthest center gap.
        condition_2_bounds = center_distances.max(axis=1) / 2.0
        condition_2_rows = np.all(previous_distances > condition_2_bounds[None, :], axis=1)
    else:
        condition_2_rows = np.zeros(len(features), dtype=bool)
    condition_2_count = int(condition_2_rows.sum())

    # MDFCM searches the immediate neighborhood of the current structure.
    # The poorly represented-point conditions remain diagnostics, but must not
    # suppress c-1: doing so creates the monotonic-growth failure seen before.
    candidate_counts = [current_k - 1, current_k, current_k + 1]
    decision = "compare valid c-1, c, c+1 candidates by Xie-Beni"

    def initialize_for_k(candidate_k: int) -> np.ndarray:
        if candidate_k == current_k:
            return previous_centroids.copy()
        if candidate_k == current_k - 1:
            if current_k < 3:
                raise ValueError("Cannot evaluate c-1 with fewer than three current clusters")
            pair_distances = center_distances.copy()
            i, j = np.unravel_index(np.argmin(np.where(pair_distances == 0, np.inf, pair_distances)), pair_distances.shape)
            merged = (previous_centroids[i] + previous_centroids[j]) / 2.0
            keep = [index for index in range(current_k) if index not in (i, j)]
            return np.vstack([previous_centroids[keep], merged])
        if candidate_k == current_k + 1:
            nearest = previous_distances.argmin(axis=1)
            within_cluster_loss = np.array(
                [previous_distances_squared[nearest == index, index].sum() for index in range(current_k)]
            )
            split_cluster = int(within_cluster_loss.argmax())
            members = features[nearest == split_cluster]
            if len(members) > 1:
                centered = members - members.mean(axis=0)
                _, eigenvectors = np.linalg.eigh(np.cov(centered, rowvar=False))
                direction = eigenvectors[:, -1]
                spread = float(np.sqrt(max(within_cluster_loss[split_cluster] / len(members), 1e-8)))
            else:
                direction = np.zeros(features.shape[1], dtype=float)
                direction[0] = 1.0
                spread = 1e-3
            offset = max(spread / 2.0, 1e-3) * direction
            centers = previous_centroids.copy()
            centers[split_cluster] -= offset
            return np.vstack([centers, previous_centroids[split_cluster] + offset])
        raise ValueError(f"Unsupported candidate cluster count: {candidate_k}")

    def fit_candidate(candidate_k: int) -> dict[str, Any]:
        centers = initialize_for_k(candidate_k)
        converged = False
        iterations = 0
        previous_objective = np.inf
        for iterations in range(1, maximum_iterations + 1):
            memberships, _ = memberships_from_centroids(features, centers, fuzziness)
            weights = memberships**fuzziness
            updated = (weights.T @ features) / np.maximum(weights.sum(axis=0)[:, None], 1e-12)
            centers = updated
            updated_memberships, updated_distances = memberships_from_centroids(
                features, centers, fuzziness
            )
            objective = float(
                np.sum((updated_memberships**fuzziness) * updated_distances)
            )
            if abs(previous_objective - objective) <= tolerance:
                converged = True
                break
            previous_objective = objective
        memberships, distance_squared = memberships_from_centroids(features, centers, fuzziness)
        objective = float(np.sum((memberships**fuzziness) * distance_squared))
        center_distance_squared = np.sum(
            (centers[:, None, :] - centers[None, :, :]) ** 2, axis=2
        )
        np.fill_diagonal(center_distance_squared, np.inf)
        minimum_separation = float(np.min(center_distance_squared))
        xb = (
            np.nan
            if candidate_k < 2 or minimum_separation <= 1e-12
            else objective / (len(features) * minimum_separation)
        )
        return {
            "centroids": centers,
            "memberships": memberships,
            "labels": memberships.argmax(axis=1).astype("int64"),
            "objective": objective,
            "xie_beni": float(xb),
            "iterations": iterations,
            "converged": converged,
        }

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
    labels = selected["labels"]
    return {
        **selected,
        "labels": labels,
        "condition_1_count": condition_1_count,
        "condition_2_count": condition_2_count,
        "condition_1_met": bool(condition_1_count),
        "condition_2_met": bool(condition_2_count),
        "decision": decision,
        "candidate_xb": candidate_xb,
        "selected_k": selected_k,
        "alpha": alpha,
        "fuzziness": fuzziness,
        "convergence_tolerance": tolerance,
    }


def classify_transition(
    is_new: int,
    previous_activity: str | None,
    current_activity: str,
    previous_cluster: str | None,
    current_cluster: str,
) -> str:
    if is_new:
        return "New"
    if previous_activity == "Inactive" and current_activity == "Active":
        return "Reactivated"
    if current_activity == "Inactive":
        return "Inactive"
    if previous_cluster is not None and not pd.isna(previous_cluster) and str(previous_cluster) == str(current_cluster):
        return "Existing Stable"
    return "Existing Migrated"


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
        ["CustomerID", "Segment_Name"]
    ].merge(country_asof, on="CustomerID", how="left")
    composition_counts = pd.crosstab(
        composition_source["Country"], composition_source["Segment_Name"]
    )
    composition_counts = composition_counts.reindex(index=geographic.index, fill_value=0)
    total_customers = composition_counts.sum(axis=1).rename("Customer_Count")
    geographic = geographic.join(total_customers, how="left")
    profile_rules = [
        ("Champions_Share", lambda names: names.eq("Champions")),
        ("Champions_At_Risk_Share", lambda names: names.eq("Champions At Risk")),
        ("Loyalists_Share", lambda names: names.eq("Loyalists")),
        ("Loyalists_At_Risk_Share", lambda names: names.eq("Loyalists At Risk")),
        ("Mid_Tier_Occasionals_Share", lambda names: names.eq("Mid-Tier Occasionals")),
        ("Mid_Tier_Occasionals_At_Risk_Share", lambda names: names.eq("Mid-Tier Occasionals At Risk")),
        ("Developing_Share", lambda names: names.eq("Developing")),
        ("Developing_At_Risk_Share", lambda names: names.eq("Developing At Risk")),
        ("Hibernating_Lost_Share", lambda names: names.eq("Hibernating / Lost")),
    ]
    profile_names = composition_source["Segment_Name"].fillna("").astype(str)
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
    growth_score = (
        profile.loc[list(remaining), "Customer_Count"].rank(pct=True)
        + profile.loc[list(remaining), "Product_Diversity"].rank(pct=True)
        + profile.loc[list(remaining), "Repeat_Purchase_Rate"].rank(pct=True)
    )
    growth = int(growth_score.idxmax())
    remaining.remove(growth)
    small = int(next(iter(remaining)))
    mapping = {dominant: 0, high_value: 1, growth: 2, small: 3}
    profile["Geographic_Cluster_Number"] = [mapping[int(raw)] for raw in profile.index]
    profile["Geographic_Segment_Name"] = profile["Geographic_Cluster_Number"].map(
        GEOGRAPHIC_SEGMENTS
    )
    return mapping, profile.reset_index()


def firmographic_name(geographic_segment: str, behavioural_segment: str) -> str:
    prefixes = {
        "Largest Revenue Market": "Largest Revenue",
        "Highest Revenue-per-Customer Market": "Highest Revenue per Customer",
        "Broader, Higher-Repeat Market": "Broader Higher-Repeat",
        "Smaller Market": "Smaller",
    }
    prefix = prefixes.get(geographic_segment, geographic_segment.replace(" Market", ""))
    return f"{prefix} {behavioural_segment}"


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
        ]
    ].rename(columns={"Highest_Membership_Score": "Average_Membership"})

    segment_summary = customer_summary.groupby(
        ["CycleID", "Stable_Cluster_ID", "Segment_Name"]
    ).agg(
        Customers=("CustomerID", "size"),
        Orders=("Orders", "sum"),
        Quantity=("Quantity", "sum"),
        Revenue=("Revenue", "sum"),
        Average_Membership=("Average_Membership", "mean"),
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
    baseline_name_map = name_rfm_clusters(baseline, baseline_labels)
    baseline["Model_Profile_Name"] = baseline["KMeans_Cluster_Number"].map(baseline_name_map)
    baseline["Segment_Name"] = baseline.apply(
        lambda row: "Hibernating / Lost" if int(row["Recency"]) > 90 else (
            f"{row['Model_Profile_Name']} At Risk"
            if int(row["Recency"]) > 30 and row["Model_Profile_Name"] in {
                "Champions", "Loyalists", "Mid-Tier Occasionals", "Developing"
            }
            else row["Model_Profile_Name"]
        ),
        axis=1,
    )
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

    preprocessing_frames = [baseline]
    dynamic_frames: list[pd.DataFrame] = []
    transition_frames: list[pd.DataFrame] = []
    cluster_lineage_frames: list[pd.DataFrame] = []
    cycle_summary_rows: list[dict[str, Any]] = []
    centroid_rows: list[dict[str, Any]] = []
    customer_summary_frames: list[pd.DataFrame] = []
    segment_summary_frames: list[pd.DataFrame] = []
    product_summary_frames: list[pd.DataFrame] = []
    business_frames: list[pd.DataFrame] = []
    behavioural_by_cycle: dict[str, pd.DataFrame] = {"Cycle_0": baseline}

    previous_state = baseline[
        ["CustomerID", "KMeans_Cluster_Number", "Stable_Cluster_ID", "Activity_Status", "Segment_Name", "Fuzzy_Membership_Details", *PCA_COLUMNS]
    ].rename(
        columns={
            "KMeans_Cluster_Number": "Cluster_Local_Index",
        }
    )
    previous_centroids = ordered_centroids
    next_cluster_number = selected_k + 1

    for cycle in cycle_definitions[1:]:
        cycle_start = time.perf_counter()
        raw_snapshot = build_behavioural_snapshot(transactions, customer_master, cycle)
        snapshot = transform_snapshot(raw_snapshot, scaler, pca)
        features = snapshot[PCA_COLUMNS].to_numpy()
        active_mask = snapshot["Activity_Status"].eq("Active").to_numpy()
        active_positions = np.flatnonzero(active_mask)
        if len(active_positions) < 2:
            raise ValueError(f"{cycle.cycle_id} has fewer than two purchasing customers")
        active_features = features[active_mask]
        active_snapshot = snapshot.loc[active_mask].reset_index(drop=True)
        fuzzy = dynamic_fuzzy_update(active_features, previous_centroids)
        stable_id_map, next_cluster_number, lineage = match_cluster_ids(
            previous_centroids,
            previous_state,
            fuzzy["centroids"],
            active_snapshot["CustomerID"],
            fuzzy["labels"],
            next_cluster_number,
            cycle.cycle_id,
        )
        cluster_lineage_frames.append(lineage)
        segment_name_map = name_rfm_clusters(active_snapshot, fuzzy["labels"])
        membership_matrix = np.zeros((len(snapshot), len(stable_id_map)), dtype=float)
        local_labels = np.zeros(len(snapshot), dtype="int64")
        membership_matrix[active_positions] = fuzzy["memberships"]
        local_labels[active_positions] = fuzzy["labels"]
        previous_by_customer = previous_state.drop_duplicates("CustomerID").set_index("CustomerID")
        local_by_stable_id = {stable_id: local for local, stable_id in stable_id_map.items()}
        assignment_modes = np.full(len(snapshot), "Current-cycle fuzzy fit", dtype=object)
        for position in np.flatnonzero(~active_mask):
            customer_id = snapshot.iloc[position]["CustomerID"]
            if customer_id not in previous_by_customer.index:
                assignment_modes[position] = "Projected into current profiles"
                continue
            previous_row = previous_by_customer.loc[customer_id]
            try:
                old_details = json.loads(previous_row["Fuzzy_Membership_Details"])
            except (TypeError, json.JSONDecodeError):
                old_details = []
            retained = np.zeros(len(stable_id_map), dtype=float)
            for detail in old_details:
                target = local_by_stable_id.get(str(detail.get("stable_cluster_id")))
                if target is not None:
                    retained[target] += float(detail.get("membership", 0.0))
            if retained.sum() > 0:
                membership_matrix[position] = retained / retained.sum()
                local_labels[position] = int(np.argmax(membership_matrix[position]))
                assignment_modes[position] = "Retained while inactive"
            else:
                projected, _ = memberships_from_centroids(
                    features[position:position + 1], fuzzy["centroids"], 2.0
                )
                membership_matrix[position] = projected[0]
                local_labels[position] = int(np.argmax(projected[0]))
                assignment_modes[position] = "Reassigned: prior profile no longer exists"
        snapshot["MDFCM_Cluster_Number"] = local_labels
        snapshot["PreviousCycleID"] = f"Cycle_{cycle.cycle_number - 1}"
        snapshot["CurrentCycleID"] = cycle.cycle_id
        snapshot["Cluster_Local_Index"] = snapshot["MDFCM_Cluster_Number"]
        snapshot["Stable_Cluster_ID"] = snapshot["MDFCM_Cluster_Number"].map(stable_id_map)
        snapshot["Model_Profile_Name"] = snapshot["MDFCM_Cluster_Number"].map(segment_name_map)
        snapshot["Segment_Name"] = snapshot.apply(
            lambda row: "Hibernating / Lost" if int(row["Recency"]) > 90 else (
                f"{row['Model_Profile_Name']} At Risk"
                if int(row["Recency"]) > 30 and row["Model_Profile_Name"] in {
                    "Champions", "Loyalists", "Mid-Tier Occasionals", "Developing"
                }
                else row["Model_Profile_Name"]
            ),
            axis=1,
        )
        snapshot["Assignment_Mode"] = assignment_modes
        snapshot.loc[snapshot["Recency"].gt(90), "Assignment_Mode"] = "Hibernating / Lost: no purchase in 90 days"
        at_risk_mask = snapshot["Recency"].between(31, 90)
        snapshot.loc[at_risk_mask & snapshot["Activity_Status"].eq("Inactive"), "Assignment_Mode"] = (
            "Retained while inactive; 31-90 day at-risk profile"
        )
        snapshot.loc[at_risk_mask & snapshot["Activity_Status"].eq("Active"), "Assignment_Mode"] = (
            "Current-cycle fit; 31-90 day at-risk profile"
        )
        snapshot["Highest_Membership_Score"] = membership_matrix.max(axis=1)
        snapshot["All_Fuzzy_Memberships"] = [
            json.dumps([round(float(value), 8) for value in row])
            for row in membership_matrix
        ]
        snapshot["Fuzzy_Membership_Details"] = [
            json.dumps([
                {
                    "cluster_index": index,
                    "stable_cluster_id": stable_id_map[index],
                    "segment_name": segment_name_map[index],
                    "membership": round(float(value), 8),
                }
                for index, value in enumerate(row)
            ])
            for row in membership_matrix
        ]
        previous_state_for_merge = previous_state.rename(
            columns={
                "Cluster_Local_Index": "Previous_Cluster_Local_Index",
                "Stable_Cluster_ID": "Previous_Stable_Cluster_ID",
                "Activity_Status": "Previous_Activity_Status",
                "Segment_Name": "Previous_Segment_Name",
                "Fuzzy_Membership_Details": "Previous_Fuzzy_Membership_Details",
                **{column: f"Previous_{column}" for column in PCA_COLUMNS},
            }
        )
        snapshot = snapshot.merge(previous_state_for_merge, on="CustomerID", how="left")
        counterfactual_memberships, _ = memberships_from_centroids(features, previous_centroids, 2.0)
        counterfactual_local = counterfactual_memberships.argmax(axis=1)
        previous_id_by_local = previous_state.drop_duplicates("Cluster_Local_Index").set_index(
            "Cluster_Local_Index"
        )["Stable_Cluster_ID"].to_dict()
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
                "RetainedInactiveCustomers": int(np.sum(assignment_modes == "Retained while inactive")),
                "ActiveCustomers": int(snapshot["Activity_Status"].eq("Active").sum()),
                "InactiveCustomers": int(snapshot["Activity_Status"].eq("Inactive").sum()),
                "NewCustomers": int(snapshot["Transition_Status"].eq("New").sum()),
                "ReactivatedCustomers": int(snapshot["Transition_Status"].eq("Reactivated").sum()),
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
                "CandidateXB": json.dumps(fuzzy["candidate_xb"], sort_keys=True),
                "MDFCMAlpha": float(fuzzy["alpha"]),
                "Fuzziness": float(fuzzy["fuzziness"]),
                "ConvergenceTolerance": float(fuzzy["convergence_tolerance"]),
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
            ["CustomerID", "MDFCM_Cluster_Number", "Stable_Cluster_ID", "Activity_Status", "Segment_Name", "Fuzzy_Membership_Details", *PCA_COLUMNS]
        ].rename(
            columns={
                "MDFCM_Cluster_Number": "Cluster_Local_Index",
            }
        )
        previous_centroids = fuzzy["centroids"]

    preprocessing = pd.concat(preprocessing_frames, ignore_index=True)
    dynamic_results = pd.concat(dynamic_frames, ignore_index=True)
    customer_transitions = pd.concat(transition_frames, ignore_index=True)
    cluster_lineage = pd.concat(cluster_lineage_frames, ignore_index=True)
    cycle_summary = pd.DataFrame(cycle_summary_rows)
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
    geographic_kmeans = KMeans(n_clusters=4, n_init=50, random_state=RANDOM_STATE)
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
                    "Loyalists_At_Risk_Share",
                    "Mid_Tier_Occasionals_Share",
                    "Mid_Tier_Occasionals_At_Risk_Share",
                    "Developing_Share",
                    "Developing_At_Risk_Share",
                    "Champions_At_Risk_Share",
                    "Hibernating_Lost_Share",
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
            "Segment_Name",
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
        "behavioural_features": FEATURE_COLUMNS,
        "geographic_features": GEOGRAPHIC_FEATURE_COLUMNS,
        "behavioural_segments_by_cycle": behavioural_segments_by_cycle,
        "behavioural_label_semantics": "Profile-derived and cycle-specific; labels are not persistent cluster identities.",
        "geographic_segments": GEOGRAPHIC_SEGMENTS,
        "behavioural_cluster_mapping": artifacts.behavioural_cluster_mapping,
        "geographic_cluster_mapping": artifacts.geographic_cluster_mapping,
        "window_months": 3,
        "precomputed_cycles": [cycle.cycle_id for cycle in artifacts.cycle_definitions],
        "baseline_k_selection": "maximum-distance WCSS elbow is primary decision rule; silhouette by candidate K is the supporting validity diagnostic and does not override the elbow",
        "frequency_monetary_period": "cycle transaction period, converted to monthly rate",
        "recency_period": "exact days since last qualifying purchase, uncapped; 31-60 and 61-90 day at-risk bands; >90 days Hibernating / Lost",
        "transaction_inclusion_policy": "Only positive-quantity, positive-unit-price, non-cancellation paid sales enter customer RFM, clustering, and business value summaries. Zero-price, negative-quantity, negative-price, and cancellation rows remain excluded from those model inputs and are documented in the cleaning audit.",
        "monetary_transformation": "log1p of positive paid sales; no return or cancellation subtraction",
        "monetary_sensitivity": "No net-versus-gross ranking sensitivity was fitted under the selected positive-sales-only policy. Return and cancellation summaries are audit-only.",
        "dynamic_method": "Study adaptation of Munusamy-Murugesan MDFCM; all valid c-1, c, c+1 neighboring candidate counts are fitted and ranked by Xie-Beni at every cycle",
        "dynamic_method_adaptations": "K-means Cycle 0; current-cycle purchaser batches fit monthly MDFCM candidates; c-1, c and c+1 are evaluated each cycle to allow reduction, retention and addition; inactive customers retain last model memberships while <=90 days from purchase, are displayed as Hibernating / Lost after >90 days, and re-enter the fit upon a qualifying purchase; alpha=0.05; FCM convergence by absolute objective change tolerance 0.01 or 300 iterations",
        "inactive_customer_policy": "Fit MDFCM candidates using customers with qualifying purchases in the current cycle only. Retain inactive customers in the customer-cycle output and carry forward their prior fuzzy memberships/profile where the tracked cluster remains; re-evaluate them when they purchase again. Activity status is separate from behavioural segment names.",
        "cluster_identity_policy": "Forced one-to-one minimum-cost matching by normalized centre distance and customer-overlap Jaccard; no minimum acceptance threshold; stable IDs are provisional tracking labels",
        "dynamic_observation_adaptation": "current-cycle purchaser RFM snapshots enter MDFCM fitting; inactive customers retain prior memberships separately and re-enter when a qualifying purchase occurs",
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
                {"MetadataKey": "DynamicMethod", "MetadataValue": "Study adaptation of MDFCM; full valid c-1/c/c+1 neighbourhood scored each cycle by Xie-Beni; condition counts are diagnostics"},
                {"MetadataKey": "MDFCMAlpha", "MetadataValue": "0.05"},
                {"MetadataKey": "MDFCMFuzzifier", "MetadataValue": "2"},
                {"MetadataKey": "MDFCMConvergenceTolerance", "MetadataValue": "0.01"},
                {"MetadataKey": "InactiveCustomerPolicy", "MetadataValue": "Current-cycle purchasers enter MDFCM fitting; inactive customers retain prior fuzzy memberships and behavioural profile where the tracked cluster remains, and are reassessed when a qualifying purchase returns."},
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
    plt.title("Cycle 0 K-means elbow and within-cluster sum of squares")
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
        "Inactive",
        "Reactivated",
    ]
    transition_pivot = transition_pivot.reindex(columns=transition_order, fill_value=0)
    transition_pivot.plot(
        kind="bar",
        stacked=True,
        figsize=(12, 6),
        color=["#9bd3ae", "#0b7a4b", "#e0a72f", "#8e9aaf", "#4f86c6"],
    )
    plt.title("Corrected customer transition states")
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
        "Largest Revenue Market": "#004529",
        "Highest Revenue-per-Customer Market": "#238443",
        "Broader, Higher-Repeat Market": "#78c679",
        "Smaller Market": "#d9a62e",
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
    dynamic_latest = artifacts.dynamic_results.loc[artifacts.dynamic_results["CycleID"].eq("Cycle_9")]
    if not dynamic_latest["Recency"].gt(90).any():
        raise AssertionError("Cycle 9 should identify customers beyond the 90-day inactivity threshold")
    if not dynamic_latest.loc[dynamic_latest["Recency"].gt(90), "Segment_Name"].eq("Hibernating / Lost").all():
        raise AssertionError("Customers beyond 90 days must display as Hibernating / Lost")
    if not artifacts.preprocessing["Has_Purchase_In_Recency_Window"].eq(0).any():
        raise AssertionError("No-purchase Recency cases are missing from the snapshots")
    if not artifacts.preprocessing["Activity_Status"].eq("Inactive").any():
        raise AssertionError("Inactive customers are missing from the corrected snapshots")
    observed_transitions = set(artifacts.customer_transitions["Transition_Status"].unique())
    if not observed_transitions:
        raise AssertionError("Customer transition results are empty")
    if artifacts.cycle_summary["XieBeniIndex"].isna().any():
        raise AssertionError("Xie-Beni index contains missing values")
    if not artifacts.cycle_summary["XieBeniIndex"].gt(0).all():
        raise AssertionError("Xie-Beni index must be positive")
    previous_k = int(artifacts.baseline_segmentation["Optimal_K_Value"].iloc[0])
    for cycle_row in artifacts.cycle_summary.sort_values("CycleID", key=lambda values: values.str.replace("Cycle_", "", regex=False).astype(int)).to_dict("records"):
        candidate_scores = json.loads(cycle_row["CandidateXB"])
        expected_candidates = {max(2, previous_k - 1), previous_k, previous_k + 1}
        if {int(candidate) for candidate in candidate_scores} != expected_candidates:
            raise AssertionError(f"{cycle_row['CycleID']} did not score the full valid MDFCM neighborhood")
        selected_candidate = min(candidate_scores, key=lambda candidate: candidate_scores[candidate])
        if int(selected_candidate) != int(cycle_row["SelectedK"]):
            raise AssertionError(f"{cycle_row['CycleID']} did not select the minimum-XB candidate")
        previous_k = int(cycle_row["SelectedK"])
    if set(artifacts.geographic_segmentation["CycleID"].unique()) != expected_cycles:
        raise AssertionError("Geographic segmentation does not cover all cycles")
    if artifacts.geographic_segmentation["Geographic_Segment_Name"].nunique() != 4:
        raise AssertionError("The geographic model did not produce four market segments")
    if set(artifacts.firmographic_segmentation["CycleID"].unique()) != expected_cycles:
        raise AssertionError("Firmographic customer-market results do not cover Cycle 0-9")
    if artifacts.baseline_segmentation["Optimal_K_Value"].nunique() != 1:
        raise AssertionError("Cycle 0 baseline must have one selected K")
    selected_k = int(artifacts.baseline_segmentation["Optimal_K_Value"].iloc[0])
    if artifacts.baseline_segmentation["KMeans_Cluster_Number"].nunique() != selected_k:
        raise AssertionError("Cycle 0 cluster count does not match elbow-selected K")
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
    validation_summary["database_path"] = str(database_path)
    validation_summary["figure_directory"] = str(figure_directory)
    validation_summary["output_directory"] = str(run_directory)
    (run_directory / "model_validation_summary.json").write_text(
        json.dumps(validation_summary, indent=2), encoding="utf-8"
    )
    return validation_summary
