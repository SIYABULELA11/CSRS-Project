"""Postprocess an existing CSRS run into an authoritative fitted-cluster registry.

No FCM/MDFCM fitting function is imported, changed or run by this module. All source
connections are read-only. Building a report returns in-memory frames; exporting is
an explicit operation that creates a NEW versioned directory and database copy.

Label plans are external reporting metadata, for example::

    {"labels": [{"CycleID": "Cycle_7", "localIndex": 0,
                 "businessProfile": "Mid-Tier Occasional",
                 "displayLabel": "Mid-Tier Occasional · CL-001",
                 "labelOrder": 3, "labelRationale": "Approved reporting name"}]}

Alternatively use stableClusterId instead of CycleID/localIndex to label an ID in
all observed cycles. Unspecified centres retain their factual stored profile with
an ID-qualified display name. A plan never changes numerical assignments or data.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from typing import Any, Mapping

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score, silhouette_samples
from cluster_labels import PROFILE_ORDER, PROFILE_DESCRIPTIONS, LABEL_POLICY, profile_sort_key, base_profile as profile_base_name


CURRENT_CLUSTER_TABLE = "Current_Cluster_Profiles"
QUALITY_TABLE = "Current_Model_Quality"
RFM_COLUMNS = ["Recency", "Frequency", "Monetary"]
PC_COLUMNS = ["PC1", "PC2", "PC3"]
DEFAULT_PROFILE_ORDER = PROFILE_ORDER
REGISTRY_COLUMNS = [
    "CycleID", "cycleId", "cycleNumber", "localIndex", "stableClusterId",
    "businessProfile", "displayLabel", "labelOrder", "labelRationale", "storedBusinessProfile",
    "PC1", "PC2", "PC3", "hardWinnerCustomers", "fuzzyMembershipMass",
    "weightedRecency", "weightedFrequency", "weightedMonetary",
    "retainedAssignedCustomers", "isSoftOnly", "fitCustomers", "fittedK", "occupiedK",
    "hardMeanRecency", "hardMeanFrequency", "hardMeanMonetary",
    "winnerMeanMembership", "fuzzyWeightMass", "fitMethod", "coordinateSource",
    "meanSilhouette", "negativeSilhouetteShare", "meanMaximumMembership",
    "hardWithinSumSquares", "fuzzyObjectiveContribution", "meanCentreDistance",
    "p95CentreDistance", "maxCentreDistance", "description",
]


@dataclass(frozen=True)
class ClusterReporting:
    """In-memory reports; construction does not write or modify any source file."""

    source_directory: Path
    registry: pd.DataFrame
    quality: pd.DataFrame
    metadata: dict[str, Any]


def _read_only(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    connection.execute("PRAGMA query_only=ON")
    return connection


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_cycle(value: Any) -> tuple[str, int]:
    if isinstance(value, str) and value.startswith("Cycle_"):
        number = int(value.removeprefix("Cycle_"))
    elif isinstance(value, (int, np.integer)):
        number = int(value)
    else:
        raise ValueError(f"Expected Cycle_N or integer cycle number, got {value!r}")
    if number < 0:
        raise ValueError("Cycle number cannot be negative")
    return f"Cycle_{number}", number


def load_label_plan(path: Path) -> dict[str, Any]:
    """Read an external plan; no names or category policy are inferred or enforced."""
    parsed = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(parsed, dict) or not isinstance(parsed.get("labels"), list):
        raise ValueError("Label plan must contain a labels array")
    return parsed


def _plan_indexes(plan: Mapping[str, Any] | None) -> tuple[dict[tuple[str, int], dict], dict[str, dict]]:
    by_cycle: dict[tuple[str, int], dict] = {}
    by_stable: dict[str, dict] = {}
    if plan is None:
        return by_cycle, by_stable
    if not isinstance(plan.get("labels"), list):
        raise ValueError("Label plan must contain a labels array")
    allowed = {"CycleID", "localIndex", "stableClusterId", "businessProfile", "displayLabel", "labelOrder", "labelRationale"}
    for item in plan["labels"]:
        if not isinstance(item, dict) or set(item) - allowed:
            raise ValueError(f"Unknown or malformed label-plan fields: {item!r}")
        if "CycleID" in item or "localIndex" in item:
            if "CycleID" not in item or "localIndex" not in item:
                raise ValueError("Cycle-specific labels need both CycleID and localIndex")
            cycle, _ = _canonical_cycle(item["CycleID"])
            local = int(item["localIndex"])
            if local < 0 or local != item["localIndex"]:
                raise ValueError("localIndex must be a non-negative integer")
            key = (cycle, local)
            if key in by_cycle:
                raise ValueError(f"Duplicate cycle/centre label: {key}")
            by_cycle[key] = item
        else:
            stable = str(item.get("stableClusterId", "")).strip()
            if not stable or stable in by_stable:
                raise ValueError("Stable-ID plans need a nonblank unique stableClusterId")
            by_stable[stable] = item
        for field in ["businessProfile", "displayLabel", "labelRationale"]:
            if field in item and (not isinstance(item[field], str) or not item[field].strip()):
                raise ValueError(f"{field} must be nonblank text")
        if "labelOrder" in item and (not isinstance(item["labelOrder"], int) or item["labelOrder"] < 0):
            raise ValueError("labelOrder must be a non-negative integer")
    return by_cycle, by_stable


def _membership(features: np.ndarray, centres: np.ndarray, fuzziness: float) -> np.ndarray:
    """Evaluate the standard membership equation at EXISTING fitted centres only."""
    if fuzziness <= 1 or not np.isfinite(fuzziness):
        raise ValueError("Fuzzifier must be finite and greater than one")
    squared = ((features[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
    exact = squared <= 1e-24
    safe = np.maximum(squared, 1e-24)
    relative = safe / safe.min(axis=1, keepdims=True)
    inverse = relative ** (-1.0 / (fuzziness - 1.0))
    memberships = inverse / inverse.sum(axis=1, keepdims=True)
    rows = np.flatnonzero(exact.any(axis=1))
    if len(rows):
        matches = exact[rows].astype(float)
        memberships[rows] = matches / matches.sum(axis=1, keepdims=True)
    return memberships


def _baseline_centres(run: Path, baseline: pd.DataFrame, metadata: Mapping[str, Any]) -> tuple[np.ndarray, str]:
    model_file = run / "cycle0_kmeans_model.pkl"
    mapping = metadata.get("behavioural_cluster_mapping")
    if model_file.is_file() and mapping is not None:
        model = joblib.load(model_file)
        raw = np.asarray(model.cluster_centers_, dtype=float)
        conversion = {int(key): int(value) for key, value in mapping.items()}
        if set(conversion) != set(range(len(raw))) or set(conversion.values()) != set(range(len(raw))):
            raise ValueError("Baseline raw-to-local centre mapping is not a bijection")
        ordered = np.empty_like(raw)
        for raw_index, local in conversion.items():
            ordered[local] = raw[raw_index]
        return ordered, "Saved baseline K-means centres at full precision"
    values = baseline.Initial_Centroids.dropna().unique()
    if len(values) != 1:
        raise ValueError("Baseline centres are missing or inconsistent")
    return np.asarray(json.loads(values[0]), dtype=float), "Stored baseline Initial_Centroids (rounded serialization)"


def _current_ids(lineage: pd.DataFrame, cycle: str, k: int) -> dict[int, str]:
    current = lineage.loc[
        lineage.CycleID.eq(cycle)
        & lineage.CurrentLocalCluster.notna()
        & lineage.CurrentStableClusterID.notna()
        & (lineage.IsPrimaryMatch.eq(1) | lineage.LineageEvent.eq("created"))
    ]
    ids: dict[int, str] = {}
    for row in current.itertuples(index=False):
        local = int(row.CurrentLocalCluster)
        if local in ids:
            raise ValueError(f"{cycle} local centre {local} has duplicate authoritative ID rows")
        ids[local] = str(row.CurrentStableClusterID)
    if set(ids) != set(range(k)) or len(set(ids.values())) != k:
        raise ValueError(f"{cycle} has an incomplete or nonunique fitted-centre identity map")
    return ids


def _profiles_from_details(rows: pd.DataFrame, ids: Mapping[int, str]) -> dict[int, str]:
    """Inspect full vectors so centres without highest-membership customers remain visible."""
    names: dict[int, str] = {}
    for encoded in rows.Fuzzy_Membership_Details:
        details = json.loads(encoded)
        for item in details:
            local = int(item["cluster_index"])
            if local not in ids or str(item["stable_cluster_id"]) != ids[local]:
                raise ValueError("Current fit membership metadata contradicts authoritative lineage")
            name = str(item.get("segment_name", "")).strip()
            if name:
                if local in names and names[local] != name:
                    raise ValueError(f"Inconsistent current business profile for local centre {local}")
                names[local] = name
    return names


def _quality(cycle: str, number: int, rows: pd.DataFrame, centres: np.ndarray,
             memberships: np.ndarray, labels: np.ndarray, fuzziness: float,
             method: str, summary: Mapping[str, Any]) -> dict[str, Any]:
    features = rows[PC_COLUMNS].to_numpy(float)
    n, k = len(rows), len(centres)
    occupied = len(np.unique(labels))
    valid_hard_partition = 2 <= occupied < n
    squared = ((features[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
    inertia = float(squared[np.arange(n), labels].sum())
    fuzzy_objective = xb = mean_membership = floor = None
    if number != 0:
        fuzzy_objective = float(((memberships ** fuzziness) * squared).sum())
        separations = [float(np.sum((centres[i] - centres[j]) ** 2))
                       for i in range(k) for j in range(i + 1, k)]
        separation = min(separations) if separations else 0.0
        if separation > 1e-12:
            xb = fuzzy_objective / (n * separation)
        mean_membership = float(memberships.max(axis=1).mean())
        floor = 1.0 / k
    return {
        "CycleID": cycle, "cycleId": cycle, "cycleNumber": number,
        "fitMethod": method, "ModelFitCustomers": n, "SelectedK": k,
        "OccupiedK": occupied, "SoftOnlyCentres": k - occupied,
        "SilhouetteScore": float(silhouette_score(features, labels)) if valid_hard_partition else None,
        "DaviesBouldinScore": float(davies_bouldin_score(features, labels)) if valid_hard_partition else None,
        "CalinskiHarabaszScore": float(calinski_harabasz_score(features, labels)) if valid_hard_partition else None,
        "Inertia": inertia, "FuzzyObjective": fuzzy_objective, "XieBeniIndex": xb,
        "AverageMembership": mean_membership, "MembershipFloor": floor,
        "Fuzziness": None if number == 0 else fuzziness,
        "Converged": None if number == 0 else int(summary.get("Converged", 0)),
        "Iterations": None if number == 0 else int(summary.get("Iterations", 0)),
        "SelectedOperation": "static_kmeans" if number == 0 else summary.get("SelectedOperation"),
        "MetricScope": "Crisp baseline numeric labels" if number == 0 else "Current fitted observations; hard metrics use highest-membership numeric labels, fuzzy metrics use every fitted centre",
        "UnavailableHardMetricReason": None if valid_hard_partition else "Fewer than two occupied groups or one group per observation",
    }


def build_reporting(run_directory: Path, label_plan: Mapping[str, Any] | None = None) -> ClusterReporting:
    """Return a registry and fresh quality metrics without writing files or refitting any model."""
    run = run_directory.resolve()
    source_db = run / "csrs_pipeline_b_repaired.db"
    if not source_db.is_file():
        raise FileNotFoundError(source_db)
    model_metadata_file = run / "model_metadata.json"
    model_metadata = json.loads(model_metadata_file.read_text(encoding="utf-8")) if model_metadata_file.is_file() else {}
    cycle_labels, stable_labels = _plan_indexes(label_plan)
    used_cycle: set[tuple[str, int]] = set()
    used_stable: set[str] = set()
    with _read_only(source_db) as connection:
        baseline = pd.read_sql_query("SELECT * FROM Time_Cycle_0_Segmentation ORDER BY CustomerID", connection)
        dynamic = pd.read_sql_query("SELECT * FROM Dynamic_Loop_Results ORDER BY DynamicID", connection)
        preprocessing = pd.read_sql_query("SELECT * FROM Data_Preprocessing_Results", connection)
        dynamic_centres = pd.read_sql_query("SELECT * FROM Dynamic_Centroids", connection)
        lineage = pd.read_sql_query("SELECT * FROM Cluster_Lineage", connection)
        summary = pd.read_sql_query("SELECT * FROM Dynamic_Cycle_Summary", connection)
    if preprocessing.duplicated(["CycleID", "CustomerID"]).any():
        raise ValueError("Duplicate source customer-cycle preprocessing keys")
    expected_cycles = sorted(preprocessing.CycleID.unique(), key=lambda value: _canonical_cycle(value)[1])
    registry_rows: list[dict[str, Any]] = []
    quality_rows: list[dict[str, Any]] = []
    history_counts: list[dict[str, Any]] = []
    numerical_digest = hashlib.sha256()
    for cycle in expected_cycles:
        cycle, number = _canonical_cycle(cycle)
        pca = preprocessing.loc[preprocessing.CycleID.eq(cycle)].set_index("CustomerID")
        if number == 0:
            source = baseline.copy()
            rows = pca.loc[source.CustomerID].copy()
            centres, coordinate_source = _baseline_centres(run, baseline, model_metadata)
            if baseline.Optimal_K_Value.nunique() != 1 or int(baseline.Optimal_K_Value.iloc[0]) != len(centres):
                raise ValueError("Baseline fitted centres contradict its selected K")
            labels = source.Cluster_Local_Index.to_numpy(int)
            memberships = np.eye(len(centres), dtype=float)[labels]
            ids = {}
            names = {}
            for local, group in source.groupby("Cluster_Local_Index"):
                if group.Stable_Cluster_ID.nunique() != 1:
                    raise ValueError("Baseline local centre has more than one stable ID")
                ids[int(local)] = str(group.Stable_Cluster_ID.iloc[0])
                if "Model_Profile_Name" in group:
                    names[int(local)] = str(group.Model_Profile_Name.iloc[0])
                else:
                    names[int(local)] = str(group.Segment_Name.iloc[0])
            if set(ids) != set(range(len(centres))):
                raise ValueError("Baseline fitted-centre identity mapping is incomplete")
            retained = pd.Series(dtype="int64")
            method = "K-means"
            fuzziness = 2.0  # one-hot weights are unchanged by the exponent
            settings: Mapping[str, Any] = {}
            retired_history = 0
        else:
            all_customers = dynamic.loc[dynamic.CycleID.eq(cycle)]
            fit_mask = (all_customers.Is_Model_Fit.eq(1) if "Is_Model_Fit" in all_customers
                        else all_customers.Activity_Status.eq("Active"))
            source = all_customers.loc[fit_mask].copy()
            rows = pca.loc[source.CustomerID].copy()
            centre_frame = dynamic_centres.loc[dynamic_centres.CycleID.eq(cycle)].sort_values("ClusterID")
            if centre_frame.ClusterID.tolist() != list(range(len(centre_frame))):
                raise ValueError(f"{cycle} fitted-centre local indices are not contiguous")
            centres = centre_frame[PC_COLUMNS].to_numpy(float)
            ids = _current_ids(lineage, cycle, len(centres))
            names = _profiles_from_details(source, ids)
            cycle_summary = summary.loc[summary.CycleID.eq(cycle)]
            if len(cycle_summary) != 1:
                raise ValueError(f"{cycle} has no unique stored model summary")
            settings = cycle_summary.iloc[0].to_dict()
            if int(settings["SelectedK"]) != len(centres):
                raise ValueError(f"{cycle} fitted centroid count contradicts stored selected K")
            fuzziness = float(settings["Fuzziness"])
            memberships = _membership(rows[PC_COLUMNS].to_numpy(float), centres, fuzziness)
            labels = memberships.argmax(axis=1)
            if not np.array_equal(labels, source.Cluster_Local_Index.to_numpy(int)):
                raise ValueError(f"{cycle} recomputed numeric labels contradict stored purchaser labels")
            for local, stable in ids.items():
                assigned = source.loc[source.Cluster_Local_Index.eq(local), "Stable_Cluster_ID"]
                if not assigned.eq(stable).all():
                    raise ValueError(f"{cycle} purchaser IDs contradict authoritative fitted registry")
            inactive = all_customers.loc[~fit_mask]
            retained = inactive.groupby("Stable_Cluster_ID").size()
            retired_history = int(inactive.loc[~inactive.Stable_Cluster_ID.isin(ids.values())].shape[0])
            coordinate_source = "Stored fitted Dynamic_Centroids at full precision"
            method = "MDFCM"
        if not len(rows) or centres.shape != (len(ids), 3):
            raise ValueError(f"{cycle} invalid fitted observation or centroid dimensions")
        if not np.isfinite(centres).all() or not np.isfinite(rows[RFM_COLUMNS + PC_COLUMNS].to_numpy(float)).all():
            raise ValueError(f"{cycle} non-finite source coordinates or RFM")
        k = len(centres)
        occupied = len(np.unique(labels))
        weights = memberships ** fuzziness
        numeric_rfm = rows[RFM_COLUMNS].to_numpy(float)
        coordinates = rows[PC_COLUMNS].to_numpy(float)
        squared_distances = ((coordinates[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
        sample_silhouettes = (silhouette_samples(coordinates, labels)
                              if 2 <= occupied < len(rows) else np.full(len(rows), np.nan))
        quality_rows.append(_quality(cycle, number, rows, centres, memberships, labels, fuzziness, method, settings))
        numerical_digest.update(cycle.encode("utf-8"))
        for array in [centres, rows[PC_COLUMNS].to_numpy(float), labels.astype("int64"), memberships]:
            numerical_digest.update(np.ascontiguousarray(array).tobytes())
        for local in range(k):
            stable = ids[local]
            base_profile = names.get(local, "Unlabelled model profile")
            explicit = cycle_labels.get((cycle, local))
            if explicit is not None:
                used_cycle.add((cycle, local))
                if "stableClusterId" in explicit and explicit["stableClusterId"] != stable:
                    raise ValueError(f"Label plan has wrong stable ID for {(cycle, local)}")
            else:
                explicit = stable_labels.get(stable, {})
                if explicit:
                    used_stable.add(stable)
            business = str(explicit.get("businessProfile", base_profile))
            display = str(explicit.get("displayLabel", business))
            if sum(value == base_profile for value in names.values()) > 1 and "displayLabel" not in explicit:
                display = f"{business} · {stable}"
            default_order = profile_sort_key(base_profile)[0]
            order = int(explicit.get("labelOrder", default_order))
            default_rationale = ("External reporting metadata; numeric assignments, memberships and fitted centres are unchanged." if explicit else LABEL_POLICY)
            rationale = str(explicit.get("labelRationale", default_rationale))
            hard = labels == local
            hard_count = int(hard.sum())
            weight_mass = float(weights[:, local].sum())
            weighted = np.average(numeric_rfm, axis=0, weights=weights[:, local]) if weight_mass > 0 else np.full(3, np.nan)
            hard_means = numeric_rfm[hard].mean(axis=0) if hard_count else np.full(3, np.nan)
            distances = np.sqrt(squared_distances[hard, local])
            registry_rows.append({
                "CycleID": cycle, "cycleId": cycle, "cycleNumber": number,
                "localIndex": local, "stableClusterId": stable,
                "businessProfile": business, "storedBusinessProfile": base_profile, "displayLabel": display, "labelOrder": order,
                "labelRationale": rationale, **dict(zip(PC_COLUMNS, centres[local].tolist())),
                "hardWinnerCustomers": hard_count,
                "fuzzyMembershipMass": float(memberships[:, local].sum()),
                "weightedRecency": float(weighted[0]), "weightedFrequency": float(weighted[1]),
                "weightedMonetary": float(weighted[2]),
                "retainedAssignedCustomers": int(retained.get(stable, 0)),
                "isSoftOnly": int(hard_count == 0), "fitCustomers": len(rows),
                "fittedK": k, "occupiedK": occupied,
                "hardMeanRecency": float(hard_means[0]), "hardMeanFrequency": float(hard_means[1]),
                "hardMeanMonetary": float(hard_means[2]),
                "winnerMeanMembership": float(memberships[hard, local].mean()) if hard_count else None,
                "fuzzyWeightMass": weight_mass, "fitMethod": method,
                "coordinateSource": coordinate_source,
                "meanSilhouette": float(sample_silhouettes[hard].mean()) if hard_count else None,
                "negativeSilhouetteShare": float((sample_silhouettes[hard] < 0).mean()) if hard_count and occupied >= 2 else None,
                "meanMaximumMembership": float(memberships[hard, local].mean()) if hard_count and number != 0 else None,
                "hardWithinSumSquares": float(squared_distances[hard, local].sum()),
                "fuzzyObjectiveContribution": float((weights[:, local] * squared_distances[:, local]).sum()) if number != 0 else None,
                "meanCentreDistance": float(distances.mean()) if hard_count else None,
                "p95CentreDistance": float(np.quantile(distances, .95)) if hard_count else None,
                "maxCentreDistance": float(distances.max()) if hard_count else None,
                "description": PROFILE_DESCRIPTIONS.get(profile_base_name(business), "A fitted profile described by its current RFM values."),
            })
        history_counts.append({"CycleID": cycle, "fitCustomers": len(rows), "fittedK": k,
                               "occupiedK": occupied, "retiredHistoricalCustomersOutsideCurrentFittedK": retired_history})
    unknown_cycles = set(cycle_labels) - used_cycle
    unknown_stable = set(stable_labels) - used_stable
    if unknown_cycles or unknown_stable:
        raise ValueError(f"Label plan contains unmatched entries: cycles={sorted(unknown_cycles)}, IDs={sorted(unknown_stable)}")
    registry = pd.DataFrame(registry_rows, columns=REGISTRY_COLUMNS)
    registry = registry.sort_values(["cycleNumber", "labelOrder", "localIndex"]).reset_index(drop=True)
    quality = pd.DataFrame(quality_rows).sort_values("cycleNumber").reset_index(drop=True)
    if registry.duplicated(["CycleID", "localIndex"]).any() or registry.duplicated(["CycleID", "stableClusterId"]).any():
        raise ValueError("Fitted registry contains duplicate cycle/local or cycle/stable IDs")
    if registry.duplicated(["CycleID", "displayLabel"]).any():
        raise ValueError("Display labels must be unique within each cycle; add a stable-ID or factual qualifier")
    for row in quality.itertuples(index=False):
        entries = registry.loc[registry.CycleID.eq(row.CycleID)]
        if len(entries) != int(row.SelectedK) or entries.hardWinnerCustomers.sum() != int(row.ModelFitCustomers):
            raise ValueError(f"Registry count or hard population does not reconcile for {row.CycleID}")
    metadata = {
        "source_directory": str(run), "source_database_sha256": _sha256(source_db),
        "numerical_source_signature_sha256": numerical_digest.hexdigest(),
        "processing_scope": "Reporting postprocessing only; no FCM/MDFCM fitting or structural decision is rerun, and no source file is modified.",
        "fuzzy_weighted_RFM_definition": "For each fitted centre, sum(u^m * observed raw RFM)/sum(u^m) among its current fitted observations; current m=2. Baseline crisp one-hot weights reproduce hard means.",
        "population_scope": "Cycle 0 uses crisp baseline observations. Dynamic statistics use every current fitted observation identified by Is_Model_Fit; full-population runs include every observed customer regardless of current-month purchases. Legacy purchaser-only runs retain their historical scope.",
        "baseline_fuzzy_metric_policy": "Fuzzy objective, Xie-Beni and fuzzy maximum membership are unavailable for the crisp K-means baseline.",
        "centroid_policy": "Actual fitted centre coordinates in the shared PCA basis, including soft-only centres; not business-group mean positions.",
        "label_policy": "Optional external reporting labels do not change numerical clusters. Default labels preserve the stored profile plus a unique stable-ID qualifier. No claim that arbitrary nine categories uniquely match every fitted K.",
        "external_label_plan": dict(label_plan) if label_plan is not None else None,
        "cluster_counts": history_counts,
    }
    return ClusterReporting(run, registry, quality, metadata)


def export_reporting(reporting: ClusterReporting, output_parent: Path, *, copy_models: bool = True) -> Path:
    """Explicitly create a new versioned DB copy and registry/quality CSVs; never edit the source."""
    parent = output_parent.resolve()
    parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    output = parent / f"reporting_{stamp}"
    output.mkdir(exist_ok=False)
    source_database = reporting.source_directory / "csrs_pipeline_b_repaired.db"
    if _sha256(source_database) != reporting.metadata["source_database_sha256"]:
        raise ValueError("Source database changed after this in-memory reporting snapshot was built")
    target_database = output / source_database.name
    with _read_only(source_database) as source, sqlite3.connect(target_database) as target:
        source.backup(target)
        # SQLite identifiers are case-insensitive: cycleId is an API/CSV alias of CycleID.
        reporting.registry.drop(columns=["cycleId"]).to_sql(CURRENT_CLUSTER_TABLE, target, index=False, if_exists="replace")
        reporting.quality.drop(columns=["cycleId"]).to_sql(QUALITY_TABLE, target, index=False, if_exists="replace")
        target.execute(f'CREATE UNIQUE INDEX idx_current_cluster_cycle_local ON {CURRENT_CLUSTER_TABLE}(CycleID,localIndex)')
        target.execute(f'CREATE UNIQUE INDEX idx_current_cluster_cycle_id ON {CURRENT_CLUSTER_TABLE}(CycleID,stableClusterId)')
        target.execute(f'CREATE UNIQUE INDEX idx_current_cluster_display ON {CURRENT_CLUSTER_TABLE}(CycleID,displayLabel)')
        target.execute(f'CREATE UNIQUE INDEX idx_current_quality_cycle ON {QUALITY_TABLE}(CycleID)')
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("New reporting database integrity check failed")
    reporting.registry.to_csv(output / "current_cluster_profiles.csv", index=False)
    reporting.quality.to_csv(output / "current_model_quality.csv", index=False)
    if copy_models:
        for source_file in reporting.source_directory.glob("*.pkl"):
            shutil.copy2(source_file, output / source_file.name)
        for filename in ["model_metadata.json", "model_validation_summary.json"]:
            source_file = reporting.source_directory / filename
            if source_file.is_file():
                shutil.copy2(source_file, output / filename)
    metadata = {**reporting.metadata, "reporting_output_directory": str(output),
                "registry_table": CURRENT_CLUSTER_TABLE, "quality_table": QUALITY_TABLE,
                "source_model_files_copied_without_refitting": copy_models}
    (output / "cluster_reporting_metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    return output


def install_current_reporting(run_directory: Path) -> dict[str, Any]:
    """Explicitly enrich a newly rebuilt run with independently recomputed reports.

    This operation writes the supplied run database; callers must select the new
    rebuild, never an archived reference run. Numerical model tables are untouched.
    """
    report = build_reporting(run_directory)
    database = run_directory / "csrs_pipeline_b_repaired.db"
    with sqlite3.connect(database) as connection:
        report.registry.drop(columns=["cycleId"]).to_sql(CURRENT_CLUSTER_TABLE, connection, index=False, if_exists="replace")
        report.quality.drop(columns=["cycleId"]).to_sql(QUALITY_TABLE, connection, index=False, if_exists="replace")
        connection.execute(f'CREATE UNIQUE INDEX idx_current_cluster_cycle_local ON {CURRENT_CLUSTER_TABLE}(CycleID,localIndex)')
        connection.execute(f'CREATE UNIQUE INDEX idx_current_cluster_cycle_id ON {CURRENT_CLUSTER_TABLE}(CycleID,stableClusterId)')
        connection.execute(f'CREATE UNIQUE INDEX idx_current_cluster_display ON {CURRENT_CLUSTER_TABLE}(CycleID,displayLabel)')
        connection.execute(f'CREATE UNIQUE INDEX idx_current_quality_cycle ON {QUALITY_TABLE}(CycleID)')
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Reporting database integrity check failed")
    report.registry.to_csv(run_directory / "current_cluster_profiles.csv", index=False)
    report.registry[["CycleID", "localIndex", "stableClusterId", "displayLabel", "PC1", "PC2", "PC3"]].to_csv(run_directory / "per_cluster_centroids.csv", index=False)
    report.registry[["CycleID", "localIndex", "stableClusterId", "displayLabel", "hardWinnerCustomers", "meanSilhouette", "negativeSilhouetteShare", "meanMaximumMembership", "hardWithinSumSquares", "fuzzyObjectiveContribution", "meanCentreDistance", "p95CentreDistance", "maxCentreDistance"]].to_csv(run_directory / "per_cluster_quality.csv", index=False)
    report.quality.to_csv(run_directory / "current_model_quality.csv", index=False)
    metadata = {**report.metadata, "installed_in_run": str(run_directory),
                "registry_table": CURRENT_CLUSTER_TABLE, "quality_table": QUALITY_TABLE}
    (run_directory / "cluster_reporting_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return {"registry_rows": len(report.registry), "quality_cycles": len(report.quality)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--label-plan", type=Path)
    parser.add_argument("--output-parent", type=Path, help="Explicit export: create a NEW versioned directory/database; otherwise preview in memory only")
    args = parser.parse_args()
    plan = load_label_plan(args.label_plan) if args.label_plan else None
    report = build_reporting(args.run_dir, plan)
    result: dict[str, Any] = {"source": str(report.source_directory), "registry_rows": len(report.registry),
                              "cluster_counts": report.metadata["cluster_counts"],
                              "exported": False}
    if args.output_parent is not None:
        result["output_directory"] = str(export_reporting(report, args.output_parent))
        result["exported"] = True
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
