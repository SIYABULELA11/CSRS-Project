from __future__ import annotations

import json
import os
import shutil
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import matplotlib
import numpy as np
import pandas as pd
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
BEHAVIOURAL_SEGMENTS = {
    0: "Champions",
    1: "Core Loyalists",
    2: "Mid-Tier Occasionals",
    3: "Hibernating / Lost",
}
GEOGRAPHIC_SEGMENTS = {
    0: "Dominant Core Market",
    1: "High-Value Export Market",
    2: "Growth Export Market",
    3: "Small Emerging Market",
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
GEOGRAPHIC_FEATURE_COLUMNS = [
    "Log_Customer_Count",
    "Log_Revenue",
    "Log_Orders_Per_Customer",
    "Log_Revenue_Per_Customer",
    "Log_Product_Diversity",
    "Repeat_Purchase_Rate",
    "Champions_Share",
    "Core_Loyalists_Share",
    "Mid_Tier_Occasionals_Share",
    "Hibernating_Lost_Share",
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
    dynamic_results: pd.DataFrame
    customer_transitions: pd.DataFrame
    cycle_summary: pd.DataFrame
    centroids: pd.DataFrame
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


def load_transactions(source_path: Path) -> pd.DataFrame:
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

    valid = (
        transactions["CustomerID"].notna()
        & transactions["InvoiceDate"].notna()
        & transactions["Quantity"].gt(0)
        & transactions["UnitPrice"].gt(0)
        & ~transactions["InvoiceNo"].str.upper().str.startswith("C")
    )
    transactions = transactions.loc[valid].copy()
    transactions["CustomerID"] = transactions["CustomerID"].astype("int64")
    transactions["Total_Price"] = transactions["Quantity"] * transactions["UnitPrice"]
    transactions = transactions.sort_values(["InvoiceDate", "InvoiceNo", "CustomerID"])
    transactions = transactions.reset_index(drop=True)
    return transactions


def build_cycle_definitions(transactions: pd.DataFrame) -> list[CycleDefinition]:
    minimum_date = transactions["InvoiceDate"].min().normalize()
    maximum_date = transactions["InvoiceDate"].max().normalize()
    baseline_start = pd.Timestamp("2010-12-01")
    baseline_snapshot = pd.Timestamp("2011-03-01")
    if minimum_date > baseline_start or maximum_date < pd.Timestamp("2011-12-01"):
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
    month_starts = pd.date_range("2011-03-01", "2011-12-01", freq="MS")
    for cycle_number, period_start in enumerate(month_starts, start=1):
        if period_start.month == 12:
            period_end = maximum_date + pd.Timedelta(days=1)
        else:
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
                phase="Precomputed simulation" if cycle_number == 10 else "Dynamic update",
            )
        )
    return definitions


def build_customer_master(transactions: pd.DataFrame) -> pd.DataFrame:
    first_purchase = transactions.groupby("CustomerID")["InvoiceDate"].min()
    last_purchase = transactions.groupby("CustomerID")["InvoiceDate"].max()
    country_counts = (
        transactions.groupby(["CustomerID", "Country"])
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
    window = history.loc[history["InvoiceDate"] >= cycle.window_start]
    eligible_customers = customer_master.loc[
        customer_master["FirstPurchaseDate"] < cycle.snapshot_date
    ].copy()

    latest_purchase = history.groupby("CustomerID")["InvoiceDate"].max()
    aggregates = window.groupby("CustomerID").agg(
        Frequency=("InvoiceNo", "nunique"),
        Monetary=("Total_Price", "sum"),
        Products=("Description", "nunique"),
        Quantity=("Quantity", "sum"),
    )
    snapshot = eligible_customers.set_index("CustomerID")
    snapshot["LatestPurchaseDate"] = latest_purchase.reindex(snapshot.index)
    snapshot = snapshot.join(aggregates, how="left")
    snapshot[["Frequency", "Monetary", "Products", "Quantity"]] = snapshot[
        ["Frequency", "Monetary", "Products", "Quantity"]
    ].fillna(0)
    snapshot["Frequency"] = snapshot["Frequency"].astype("int64")
    snapshot["Products"] = snapshot["Products"].astype("int64")
    snapshot["Quantity"] = snapshot["Quantity"].astype(float)
    snapshot["Monetary"] = snapshot["Monetary"].astype(float)
    snapshot["Recency"] = (
        cycle.snapshot_date.normalize() - snapshot["LatestPurchaseDate"].dt.normalize()
    ).dt.days.astype("int64")
    snapshot["Activity_Status"] = np.where(snapshot["Frequency"].gt(0), "Active", "Inactive")
    snapshot["Is_New"] = (
        snapshot["FirstPurchaseDate"].ge(cycle.period_start)
        & snapshot["FirstPurchaseDate"].lt(cycle.period_end)
    ).astype("int64")
    snapshot["Recency_Bucket"] = pd.cut(
        snapshot["Recency"],
        bins=[-1, 30, 60, 90, np.inf],
        labels=["0-30 days", "31-60 days", "61-90 days", "91+ days"],
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
    profile["Segment_Name"] = profile["Canonical_Cluster"].map(BEHAVIOURAL_SEGMENTS)
    return mapping, profile.reset_index()


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
    memory_weight: float = 0.25,
    maximum_iterations: int = 300,
    tolerance: float = 1e-6,
) -> dict[str, Any]:
    centroids = previous_centroids.astype(float).copy()
    converged = False
    iterations = 0
    for iterations in range(1, maximum_iterations + 1):
        memberships, _ = memberships_from_centroids(features, centroids, fuzziness)
        weights = memberships**fuzziness
        data_centroids = (weights.T @ features) / np.maximum(weights.sum(axis=0)[:, None], 1e-12)
        updated_centroids = memory_weight * previous_centroids + (1.0 - memory_weight) * data_centroids
        movement = float(np.linalg.norm(updated_centroids - centroids))
        centroids = updated_centroids
        if movement <= tolerance:
            converged = True
            break

    memberships, distance_squared = memberships_from_centroids(features, centroids, fuzziness)
    objective = float(np.sum((memberships**fuzziness) * distance_squared))
    centroid_distance_squared = np.sum(
        (centroids[:, None, :] - centroids[None, :, :]) ** 2,
        axis=2,
    )
    np.fill_diagonal(centroid_distance_squared, np.inf)
    minimum_separation = float(np.min(centroid_distance_squared))
    xie_beni = np.nan if minimum_separation <= 1e-12 else objective / (len(features) * minimum_separation)
    labels = memberships.argmax(axis=1).astype("int64")
    return {
        "centroids": centroids,
        "memberships": memberships,
        "labels": labels,
        "objective": objective,
        "xie_beni": float(xie_beni),
        "iterations": iterations,
        "converged": converged,
    }


def classify_transition(
    is_new: int,
    previous_activity: str | None,
    current_activity: str,
    previous_cluster: float | int | None,
    current_cluster: int,
) -> str:
    if is_new:
        return "New"
    if previous_activity == "Inactive" and current_activity == "Active":
        return "Reactivated"
    if current_activity == "Inactive":
        return "Inactive"
    if previous_cluster is not None and not pd.isna(previous_cluster) and int(previous_cluster) == int(current_cluster):
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
    countries = sorted(history["Country"].dropna().unique().tolist())
    geographic = pd.DataFrame({"Country": countries}).set_index("Country")

    commercial = window.groupby("Country").agg(
        Active_Customer_Count=("CustomerID", "nunique"),
        Revenue=("Total_Price", "sum"),
        Orders=("InvoiceNo", "nunique"),
        Product_Diversity=("Description", "nunique"),
        Quantity=("Quantity", "sum"),
    )
    customer_orders = (
        window.groupby(["Country", "CustomerID"])["InvoiceNo"]
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
    ].merge(customer_master[["CustomerID", "Country"]], on="CustomerID", how="left")
    composition_counts = pd.crosstab(
        composition_source["Country"], composition_source["Segment_Name"]
    )
    composition_counts = composition_counts.reindex(index=geographic.index, fill_value=0)
    total_customers = composition_counts.sum(axis=1).rename("Customer_Count")
    geographic = geographic.join(total_customers, how="left")
    for segment_name, output_column in [
        ("Champions", "Champions_Share"),
        ("Core Loyalists", "Core_Loyalists_Share"),
        ("Mid-Tier Occasionals", "Mid_Tier_Occasionals_Share"),
        ("Hibernating / Lost", "Hibernating_Lost_Share"),
    ]:
        segment_counts = composition_counts.get(segment_name, pd.Series(0, index=geographic.index))
        geographic[output_column] = segment_counts.div(
            geographic["Customer_Count"].replace(0, np.nan)
        ).fillna(0.0)

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
        "Dominant Core Market": "Dominant Core",
        "High-Value Export Market": "High-Value Export",
        "Growth Export Market": "Growth Export",
        "Small Emerging Market": "Small Emerging",
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
        "Segment_Name",
        "Highest_Membership_Score",
        "Migration_Status",
        "Transition_Status",
    ]
    period = period.merge(customer_labels[label_columns], on="CustomerID", how="inner")
    period["CycleID"] = cycle.cycle_id
    period["Revenue"] = period["Total_Price"]

    activity = period.groupby("CustomerID").agg(
        Orders=("InvoiceNo", "nunique"),
        Products=("Description", "nunique"),
        Quantity=("Quantity", "sum"),
        Revenue=("Revenue", "sum"),
    )
    customer_state_columns = [
        "CustomerID",
        "CycleID",
        "Segment_Name",
        "Highest_Membership_Score",
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
            "Segment_Name",
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

    segment_summary = customer_summary.groupby(["CycleID", "Segment_Name"]).agg(
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

    product_summary = period.groupby(["CycleID", "Segment_Name", "Description"]).agg(
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
    baseline = baseline_raw.copy()
    baseline[SCALED_FEATURE_COLUMNS] = baseline_scaled
    baseline[PCA_COLUMNS] = baseline_pca

    baseline_kmeans = KMeans(n_clusters=4, n_init=50, random_state=RANDOM_STATE)
    raw_baseline_labels = baseline_kmeans.fit_predict(baseline_pca)
    baseline_mapping, _ = order_baseline_clusters(baseline, raw_baseline_labels)
    baseline_labels = np.array([baseline_mapping[int(label)] for label in raw_baseline_labels])
    ordered_centroids = np.zeros_like(baseline_kmeans.cluster_centers_)
    for raw_cluster, canonical_cluster in baseline_mapping.items():
        ordered_centroids[canonical_cluster] = baseline_kmeans.cluster_centers_[raw_cluster]
    baseline_metrics = safe_cluster_metrics(baseline_pca, baseline_labels)
    baseline["KMeans_Cluster_Number"] = baseline_labels
    baseline["Segment_Name"] = baseline["KMeans_Cluster_Number"].map(BEHAVIOURAL_SEGMENTS)
    baseline["Highest_Membership_Score"] = 1.0
    baseline["Transition_Status"] = "Baseline"
    baseline["Migration_Status"] = "Baseline"

    preprocessing_frames = [baseline]
    dynamic_frames: list[pd.DataFrame] = []
    transition_frames: list[pd.DataFrame] = []
    cycle_summary_rows: list[dict[str, Any]] = []
    centroid_rows: list[dict[str, Any]] = []
    customer_summary_frames: list[pd.DataFrame] = []
    segment_summary_frames: list[pd.DataFrame] = []
    product_summary_frames: list[pd.DataFrame] = []
    business_frames: list[pd.DataFrame] = []
    behavioural_by_cycle: dict[str, pd.DataFrame] = {"Cycle_0": baseline}

    previous_state = baseline[
        ["CustomerID", "KMeans_Cluster_Number", "Activity_Status", "Segment_Name"]
    ].rename(
        columns={
            "KMeans_Cluster_Number": "Previous_Cluster",
            "Activity_Status": "Previous_Activity_Status",
            "Segment_Name": "Previous_Segment_Name",
        }
    )
    previous_centroids = ordered_centroids

    for cycle in cycle_definitions[1:]:
        cycle_start = time.perf_counter()
        raw_snapshot = build_behavioural_snapshot(transactions, customer_master, cycle)
        snapshot = transform_snapshot(raw_snapshot, scaler, pca)
        features = snapshot[PCA_COLUMNS].to_numpy()
        fuzzy = dynamic_fuzzy_update(features, previous_centroids)
        snapshot["MDFCM_Cluster_Number"] = fuzzy["labels"]
        snapshot["Segment_Name"] = snapshot["MDFCM_Cluster_Number"].map(BEHAVIOURAL_SEGMENTS)
        snapshot["Highest_Membership_Score"] = fuzzy["memberships"].max(axis=1)
        snapshot["All_Fuzzy_Memberships"] = [
            json.dumps([round(float(value), 8) for value in row])
            for row in fuzzy["memberships"]
        ]
        snapshot = snapshot.merge(previous_state, on="CustomerID", how="left")
        snapshot["Transition_Status"] = [
            classify_transition(
                int(row.Is_New),
                None if pd.isna(row.Previous_Activity_Status) else str(row.Previous_Activity_Status),
                str(row.Activity_Status),
                row.Previous_Cluster,
                int(row.MDFCM_Cluster_Number),
            )
            for row in snapshot.itertuples(index=False)
        ]
        snapshot["Migration_Status"] = snapshot["Transition_Status"].map(
            compatibility_migration_status
        )
        snapshot["Fuzzy_Objective"] = fuzzy["objective"]
        snapshot["Xie_Beni_Index"] = fuzzy["xie_beni"]
        snapshot["Updated_Centroids"] = json.dumps(
            [[round(float(value), 8) for value in row] for row in fuzzy["centroids"]]
        )

        metrics = safe_cluster_metrics(features, fuzzy["labels"])
        comparable = snapshot["Transition_Status"].isin(
            ["Existing Stable", "Existing Migrated"]
        )
        stable_count = int(snapshot["Transition_Status"].eq("Existing Stable").sum())
        migrated_count = int(snapshot["Transition_Status"].eq("Existing Migrated").sum())
        comparable_count = int(comparable.sum())
        migration_rate = 100.0 * migrated_count / comparable_count if comparable_count else 0.0
        cycle_summary_rows.append(
            {
                "CycleID": cycle.cycle_id,
                "CustomersProcessed": int(len(snapshot)),
                "ActiveCustomers": int(snapshot["Activity_Status"].eq("Active").sum()),
                "InactiveCustomers": int(snapshot["Activity_Status"].eq("Inactive").sum()),
                "NewCustomers": int(snapshot["Transition_Status"].eq("New").sum()),
                "ReactivatedCustomers": int(snapshot["Transition_Status"].eq("Reactivated").sum()),
                "StableCustomers": stable_count,
                "MigratedCustomers": migrated_count,
                "ComparableCustomers": comparable_count,
                "MigrationRate": migration_rate,
                "CentroidShift": float(np.mean(np.linalg.norm(fuzzy["centroids"] - previous_centroids, axis=1))),
                "Iterations": int(fuzzy["iterations"]),
                "SilhouetteScore": metrics["silhouette"],
                "DaviesBouldinScore": metrics["davies_bouldin"],
                "CalinskiHarabaszScore": metrics["calinski_harabasz"],
                "XieBeniIndex": fuzzy["xie_beni"],
                "FuzzyObjective": fuzzy["objective"],
                "AverageMembership": float(snapshot["Highest_Membership_Score"].mean()),
                "ProcessingTime": float(time.perf_counter() - cycle_start),
                "ProcessingDate": pd.Timestamp.utcnow().isoformat(),
                "WarmStartCentroids": 1,
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
                    "Previous_Cluster",
                    "MDFCM_Cluster_Number",
                    "Previous_Segment_Name",
                    "Segment_Name",
                    "Previous_Activity_Status",
                    "Activity_Status",
                    "Transition_Status",
                    "Migration_Status",
                    "Highest_Membership_Score",
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
            ["CustomerID", "MDFCM_Cluster_Number", "Activity_Status", "Segment_Name"]
        ].rename(
            columns={
                "MDFCM_Cluster_Number": "Previous_Cluster",
                "Activity_Status": "Previous_Activity_Status",
                "Segment_Name": "Previous_Segment_Name",
            }
        )
        previous_centroids = fuzzy["centroids"]

    preprocessing = pd.concat(preprocessing_frames, ignore_index=True)
    dynamic_results = pd.concat(dynamic_frames, ignore_index=True)
    customer_transitions = pd.concat(transition_frames, ignore_index=True)
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
                    "Core_Loyalists_Share",
                    "Mid_Tier_Occasionals_Share",
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
        ].merge(customer_master[["CustomerID", "Country"]], on="CustomerID", how="left")
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
            "KMeans_Cluster_Number",
            "Segment_Name",
            "PC1",
            "PC2",
            "PC3",
        ]
    ].copy()
    baseline_segmentation["Optimal_K_Value"] = 4
    baseline_segmentation["Elbow_Inertia_Value"] = float(baseline_kmeans.inertia_)
    baseline_segmentation["Silhouette_Score"] = baseline_metrics["silhouette"]
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
        dynamic_results=dynamic_results,
        customer_transitions=customer_transitions,
        cycle_summary=cycle_summary,
        centroids=centroids,
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
    if corrected_directory.exists():
        shutil.rmtree(corrected_directory)

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
    joblib.dump(artifacts.scaler, model_directory / "cycle0_feature_scaler.pkl")
    joblib.dump(artifacts.pca, model_directory / "cycle0_pca_model.pkl")
    joblib.dump(artifacts.baseline_kmeans, model_directory / "cycle0_kmeans_model.pkl")
    joblib.dump(artifacts.geographic_scaler, model_directory / "cycle0_geographic_scaler.pkl")
    joblib.dump(artifacts.geographic_kmeans, model_directory / "cycle0_geographic_kmeans.pkl")
    model_metadata = {
        "behavioural_features": FEATURE_COLUMNS,
        "geographic_features": GEOGRAPHIC_FEATURE_COLUMNS,
        "behavioural_segments": BEHAVIOURAL_SEGMENTS,
        "geographic_segments": GEOGRAPHIC_SEGMENTS,
        "behavioural_cluster_mapping": artifacts.behavioural_cluster_mapping,
        "geographic_cluster_mapping": artifacts.geographic_cluster_mapping,
        "window_months": 3,
        "precomputed_cycles": [cycle.cycle_id for cycle in artifacts.cycle_definitions],
        "cycle_10_mode": "precomputed",
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
        "FirstPurchaseDate",
        "LatestPurchaseDate",
        "Activity_Status",
        "Is_New",
        "Recency",
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
        "Previous_Cluster",
        "MDFCM_Cluster_Number",
        "Highest_Membership_Score",
        "All_Fuzzy_Memberships",
        "Migration_Status",
        "Transition_Status",
        "Previous_Activity_Status",
        "Activity_Status",
        "Previous_Segment_Name",
        "Segment_Name",
        "Updated_Centroids",
        "Dynamic_Silhouette_Score",
        "Fuzzy_Objective",
        "Xie_Beni_Index",
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
        "Dynamic_Loop_Results": dynamic_table,
        "Customer_Transitions": artifacts.customer_transitions,
        "Dynamic_Centroids": artifacts.centroids,
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
                {"MetadataKey": "Cycle10Mode", "MetadataValue": "Precomputed"},
                {"MetadataKey": "DynamicMethod", "MetadataValue": "Warm-started temporally smoothed fuzzy C-means"},
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
    palette = {
        "Champions": "#006b3c",
        "Core Loyalists": "#2a9d5b",
        "Mid-Tier Occasionals": "#78c679",
        "Hibernating / Lost": "#d9a62e",
    }

    baseline = artifacts.preprocessing.loc[
        artifacts.preprocessing["CycleID"].eq("Cycle_0")
    ].copy()
    plt.figure(figsize=(9, 6))
    for segment_name, group in baseline.groupby("Segment_Name"):
        plt.scatter(
            group["PC1"],
            group["PC2"],
            s=22,
            alpha=0.65,
            label=segment_name,
            color=palette[segment_name],
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
    for segment_name, group in evolution.groupby("Segment_Name"):
        group = group.sort_values("CycleNumber")
        plt.plot(
            group["CycleNumber"],
            group["Customers"],
            marker="o",
            linewidth=2.2,
            label=segment_name,
            color=palette[segment_name],
        )
    plt.title("Behavioural segment evolution from Cycle 0 to Cycle 10")
    plt.xlabel("Cycle")
    plt.ylabel("Customers")
    plt.xticks(range(0, 11))
    plt.legend()
    _save_figure(figure_directory / "Dynamic" / "segment_evolution_cycles_0_10.png")

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
    plt.xticks(range(1, 11))
    _save_figure(figure_directory / "Validation" / "xie_beni_index.png")

    fig, axes = plt.subplots(1, 3, figsize=(15, 4.5))
    axes[0].plot(cycle_numbers, artifacts.cycle_summary["SilhouetteScore"], marker="o", color="#006b3c")
    axes[0].set_title("Silhouette score")
    axes[1].plot(cycle_numbers, artifacts.cycle_summary["AverageMembership"], marker="o", color="#2a9d5b")
    axes[1].set_title("Average membership confidence")
    axes[2].plot(cycle_numbers, artifacts.cycle_summary["MigrationRate"], marker="o", color="#d9a62e")
    axes[2].set_title("Comparable customer migration rate")
    for axis in axes:
        axis.set_xlabel("Cycle")
        axis.set_xticks(range(1, 11))
    axes[2].set_ylabel("Percent")
    _save_figure(figure_directory / "Validation" / "dynamic_model_quality.png")

    latest_geo = artifacts.geographic_segmentation.loc[
        artifacts.geographic_segmentation["CycleID"].eq("Cycle_10")
    ].sort_values("Revenue", ascending=True)
    plt.figure(figsize=(10, 9))
    geo_colors = {
        "Dominant Core Market": "#004529",
        "High-Value Export Market": "#238443",
        "Growth Export Market": "#78c679",
        "Small Emerging Market": "#d9a62e",
    }
    plt.barh(
        latest_geo["Country"],
        latest_geo["Revenue"],
        color=latest_geo["Geographic_Segment_Name"].map(geo_colors),
    )
    plt.title("Cycle 10 geographic market segmentation")
    plt.xlabel("Three-month rolling revenue")
    plt.ylabel("Country market")
    _save_figure(figure_directory / "Geographic" / "cycle10_market_segments.png")

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
    plt.title("Geographic market segments from Cycle 0 to Cycle 10")
    plt.xlabel("Cycle")
    plt.ylabel("Country markets")
    plt.xticks(range(0, 11))
    plt.legend()
    _save_figure(figure_directory / "Geographic" / "market_segment_evolution.png")

    latest_firmographic = artifacts.firmographic_segmentation.loc[
        artifacts.firmographic_segmentation["CycleID"].eq("Cycle_10")
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
    plt.title("Cycle 10 firmographic customer-market segments")
    plt.xlabel("Customers")
    plt.ylabel("Firmographic segment")
    _save_figure(figure_directory / "Firmographic" / "cycle10_firmographic_segments.png")


def validate_artifacts(artifacts: PipelineArtifacts) -> dict[str, Any]:
    expected_cycles = {f"Cycle_{number}" for number in range(11)}
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
    if artifacts.preprocessing["Recency"].max() <= 90:
        raise AssertionError("Recency does not accumulate beyond the three-month window")
    if not artifacts.preprocessing["Activity_Status"].eq("Inactive").any():
        raise AssertionError("Inactive customers are missing from the corrected snapshots")
    required_transitions = {
        "New",
        "Existing Stable",
        "Existing Migrated",
        "Inactive",
        "Reactivated",
    }
    observed_transitions = set(artifacts.customer_transitions["Transition_Status"].unique())
    if not required_transitions.issubset(observed_transitions):
        raise AssertionError(
            f"Missing transition states: {sorted(required_transitions.difference(observed_transitions))}"
        )
    if artifacts.cycle_summary["XieBeniIndex"].isna().any():
        raise AssertionError("Xie-Beni index contains missing values")
    if not artifacts.cycle_summary["XieBeniIndex"].gt(0).all():
        raise AssertionError("Xie-Beni index must be positive")
    if set(artifacts.geographic_segmentation["CycleID"].unique()) != expected_cycles:
        raise AssertionError("Geographic segmentation does not cover all cycles")
    if artifacts.geographic_segmentation["Geographic_Segment_Name"].nunique() != 4:
        raise AssertionError("The geographic model did not produce four market segments")
    cycle_10_firmographic = artifacts.firmographic_segmentation.loc[
        artifacts.firmographic_segmentation["CycleID"].eq("Cycle_10")
    ]
    if cycle_10_firmographic.empty:
        raise AssertionError("Cycle 10 firmographic results are missing")
    if not cycle_10_firmographic["Firmographic_Segment_Name"].str.contains("Champions").any():
        raise AssertionError("Firmographic cross-product labels were not created")

    return {
        "clean_transactions": int(len(artifacts.transactions)),
        "customers": int(artifacts.customer_master["CustomerID"].nunique()),
        "cycles": len(expected_cycles),
        "cycle_10_customers": int(
            artifacts.preprocessing.loc[
                artifacts.preprocessing["CycleID"].eq("Cycle_10"), "CustomerID"
            ].nunique()
        ),
        "maximum_recency_days": int(artifacts.preprocessing["Recency"].max()),
        "inactive_records": int(artifacts.preprocessing["Activity_Status"].eq("Inactive").sum()),
        "geographic_markets_cycle_10": int(
            artifacts.geographic_segmentation.loc[
                artifacts.geographic_segmentation["CycleID"].eq("Cycle_10"), "Country"
            ].nunique()
        ),
        "firmographic_segments_cycle_10": int(
            cycle_10_firmographic["Firmographic_Segment_Name"].nunique()
        ),
        "mean_migration_rate": float(artifacts.cycle_summary["MigrationRate"].mean()),
        "mean_xie_beni": float(artifacts.cycle_summary["XieBeniIndex"].mean()),
    }


def rebuild_model(model_directory: Path) -> dict[str, Any]:
    model_directory = model_directory.resolve()
    source_path = model_directory / "Online UK_Retail.xlsx"
    database_path = model_directory / "csrs_pipeline_b.db"
    if not source_path.exists():
        raise FileNotFoundError(source_path)

    artifacts = run_pipeline(source_path)
    validation_summary = validate_artifacts(artifacts)
    figure_directory = prepare_figure_directories(model_directory)
    save_models(artifacts, model_directory)
    create_figures(artifacts, figure_directory)
    write_database(artifacts, database_path)
    validation_summary["database_path"] = str(database_path)
    validation_summary["figure_directory"] = str(figure_directory)
    (model_directory / "model_validation_summary.json").write_text(
        json.dumps(validation_summary, indent=2), encoding="utf-8"
    )
    return validation_summary
