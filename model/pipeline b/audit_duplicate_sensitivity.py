"""Measure Cycle 0 customer-level sensitivity to retaining exact duplicate rows.

This is a fixed-baseline sensitivity: the saved Cycle 0 scaler, PCA transform,
and K-means centers are held constant. It is not a full refit of Cycle 0 or the
dynamic MDFCM pipeline.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from csrs_model import (
    FEATURE_COLUMNS,
    build_behavioural_snapshot,
    build_cycle_definitions,
    build_customer_master,
    load_transactions,
    transform_snapshot,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).resolve().parent / "Online UK_Retail.xlsx",
    )
    parser.add_argument(
        "--candidate",
        type=Path,
        default=(Path(__file__).resolve().parent
                 / "repair_outputs_2026-10-23" / "run_20261024_011509"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            r"C:\Users\siyam\OneDrive - University of the Western Cape\Desktop\CSRS_Repair_Visuals\data_audit"
        ),
    )
    args = parser.parse_args()

    deduplicated = load_transactions(args.source, deduplicate_exact_rows=True)
    duplicates_retained = load_transactions(args.source, deduplicate_exact_rows=False)
    cycles = build_cycle_definitions(deduplicated)
    cycle0 = cycles[0]

    clean_customer_master = build_customer_master(deduplicated)
    retained_customer_master = build_customer_master(duplicates_retained)
    clean_snapshot = build_behavioural_snapshot(deduplicated, clean_customer_master, cycle0)
    retained_snapshot = build_behavioural_snapshot(
        duplicates_retained, retained_customer_master, cycle0
    )

    scaler = joblib.load(args.candidate / "cycle0_feature_scaler.pkl")
    pca = joblib.load(args.candidate / "cycle0_pca_model.pkl")
    kmeans = joblib.load(args.candidate / "cycle0_kmeans_model.pkl")
    metadata = json.loads((args.candidate / "model_metadata.json").read_text(encoding="utf-8"))
    cluster_mapping = {int(raw): int(canonical) for raw, canonical in metadata[
        "behavioural_cluster_mapping"
    ].items()}

    clean_transformed = transform_snapshot(clean_snapshot, scaler, pca)
    retained_transformed = transform_snapshot(retained_snapshot, scaler, pca)
    clean_transformed["Baseline_Cluster"] = kmeans.predict(
        clean_transformed[["PC1", "PC2", "PC3"]]
    )
    retained_transformed["Baseline_Cluster"] = kmeans.predict(
        retained_transformed[["PC1", "PC2", "PC3"]]
    )
    clean_transformed["Baseline_Cluster"] = clean_transformed["Baseline_Cluster"].map(
        cluster_mapping
    )
    retained_transformed["Baseline_Cluster"] = retained_transformed["Baseline_Cluster"].map(
        cluster_mapping
    )

    comparison = clean_transformed[
        ["CustomerID", "Recency", "Frequency", "Monetary", "Baseline_Cluster"]
    ].merge(
        retained_transformed[
            ["CustomerID", "Recency", "Frequency", "Monetary", "Baseline_Cluster"]
        ],
        on="CustomerID",
        how="inner",
        suffixes=("_deduplicated", "_duplicates_retained"),
        validate="one_to_one",
    )
    clean_rank = comparison["Monetary_deduplicated"].rank(pct=True)
    retained_rank = comparison["Monetary_duplicates_retained"].rank(pct=True)
    comparison["Net_Monetary_Rank_Quartile_Changed"] = (
        np.floor(clean_rank * 4).clip(upper=3)
        != np.floor(retained_rank * 4).clip(upper=3)
    )
    comparison["Baseline_Assignment_Changed"] = (
        comparison["Baseline_Cluster_deduplicated"]
        != comparison["Baseline_Cluster_duplicates_retained"]
    )

    summary = {
        "cycle": "Cycle_0",
        "duplicate_rows_retained_in_alternative": int(
            len(duplicates_retained) - len(deduplicated)
        ),
        "customers_compared": int(len(comparison)),
        "net_monetary_spearman_rank_correlation": round(
            float(spearmanr(
                comparison["Monetary_deduplicated"],
                comparison["Monetary_duplicates_retained"],
            ).statistic),
            6,
        ),
        "customers_changing_net_monetary_rank_quartile": int(
            comparison["Net_Monetary_Rank_Quartile_Changed"].sum()
        ),
        "share_changing_net_monetary_rank_quartile": round(
            float(comparison["Net_Monetary_Rank_Quartile_Changed"].mean()), 6
        ),
        "customers_changing_assignment_under_fixed_cycle0_centers": int(
            comparison["Baseline_Assignment_Changed"].sum()
        ),
        "share_changing_assignment_under_fixed_cycle0_centers": round(
            float(comparison["Baseline_Assignment_Changed"].mean()), 6
        ),
        "limitation": (
            "Fixed Cycle 0 scaler, PCA, and K-means centers; this isolates the "
            "assignment effect of the duplicate-sensitive feature change and is "
            "not a full refit or a dynamic MDFCM sensitivity run."
        ),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "duplicate_sensitivity_cycle0.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    comparison.to_csv(args.output / "duplicate_sensitivity_cycle0_customers.csv", index=False)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
