from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.text import Annotation
import pandas as pd


from cluster_labels import PROFILE_ORDER, PROFILE_COLORS, profile_sort_key, profile_color


def load_centroids(connection: sqlite3.Connection) -> pd.DataFrame:
    if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Current_Cluster_Profiles'").fetchone():
        return pd.read_sql_query(
            "SELECT cycleNumber AS cycle, localIndex AS cluster_local_index, "
            "stableClusterId AS stable_cluster_id, displayLabel AS model_profile, "
            "PC1, PC2, PC3 FROM Current_Cluster_Profiles ORDER BY stableClusterId, cycleNumber", connection)
    row = connection.execute(
        "SELECT Initial_Centroids FROM Time_Cycle_0_Segmentation LIMIT 1"
    ).fetchone()
    initial_centroids = json.loads(row[0]) if row and row[0] else []
    baseline_profiles = pd.read_sql_query(
        """
        SELECT Cluster_Local_Index AS cluster,
               Stable_Cluster_ID AS stable_cluster_id,
               MIN(Model_Profile_Name) AS model_profile
        FROM Time_Cycle_0_Segmentation
        GROUP BY Cluster_Local_Index, Stable_Cluster_ID
        ORDER BY Cluster_Local_Index
        """,
        connection,
    )
    if len(initial_centroids) != len(baseline_profiles):
        raise ValueError(
            "Cycle 0 centroid coordinates do not match the distinct baseline clusters."
        )

    baseline_rows = []
    for profile in baseline_profiles.itertuples(index=False):
        coordinates = initial_centroids[int(profile.cluster)]
        baseline_rows.append(
            {
                "cycle": 0,
                "cluster_local_index": int(profile.cluster),
                "stable_cluster_id": profile.stable_cluster_id,
                "model_profile": profile.model_profile,
                "PC1": float(coordinates[0]),
                "PC2": float(coordinates[1]),
                "PC3": float(coordinates[2]),
            }
        )

    dynamic = pd.read_sql_query(
        """
        SELECT CAST(REPLACE(dc.CycleID, 'Cycle_', '') AS INTEGER) AS cycle,
               dc.ClusterID AS cluster_local_index,
               dc.PC1, dc.PC2, dc.PC3
        FROM Dynamic_Centroids dc
        WHERE CAST(REPLACE(dc.CycleID, 'Cycle_', '') AS INTEGER) BETWEEN 1 AND 9
        ORDER BY cycle, cluster_local_index
        """,
        connection,
    )

    lineage_rows = pd.read_sql_query(
        """
        SELECT CycleID, CurrentLocalCluster, CurrentStableClusterID
        FROM Cluster_Lineage
        WHERE CurrentLocalCluster IS NOT NULL
          AND CurrentStableClusterID IS NOT NULL
          AND (IsPrimaryMatch = 1 OR LineageEvent = 'created')
        """,
        connection,
    )
    stable_ids: dict[tuple[int, int], str] = {}
    for row in lineage_rows.itertuples(index=False):
        key = (int(str(row.CycleID).replace("Cycle_", "")), int(row.CurrentLocalCluster))
        stable_id = str(row.CurrentStableClusterID)
        if key in stable_ids and stable_ids[key] != stable_id:
            raise ValueError(f"Fitted centre {key} maps to multiple tracking IDs.")
        stable_ids[key] = stable_id

    # Soft-only centres do not necessarily win any customer's highest-
    # membership label. Read each active customer's full stored vector, which
    # includes the model's profile name for every fitted local centre.
    membership_rows = connection.execute(
        """
        SELECT CycleID, Fuzzy_Membership_Details
        FROM Dynamic_Loop_Results
        WHERE Activity_Status = 'Active'
        """
    )
    profile_mass: dict[tuple[int, int], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for cycle_id, details_json in membership_rows:
        try:
            details = json.loads(details_json or "[]")
        except (TypeError, json.JSONDecodeError):
            continue
        cycle_number = int(str(cycle_id).replace("Cycle_", ""))
        for detail in details:
            try:
                cluster_index = int(detail["cluster_index"])
                profile = str(detail["segment_name"]).strip()
                membership = max(0.0, float(detail["membership"]))
            except (KeyError, TypeError, ValueError):
                continue
            if profile:
                profile_mass[(cycle_number, cluster_index)][profile] += membership

    dynamic["stable_cluster_id"] = dynamic.apply(
        lambda row: stable_ids.get((int(row["cycle"]), int(row["cluster_local_index"]))), axis=1
    )
    dynamic["model_profile"] = dynamic.apply(
        lambda row: (
            max(
                profile_mass[(int(row["cycle"]), int(row["cluster_local_index"]))].items(),
                key=lambda item: item[1],
            )[0]
            if profile_mass.get((int(row["cycle"]), int(row["cluster_local_index"])))
            else None
        ),
        axis=1,
    )
    if dynamic[["stable_cluster_id", "model_profile"]].isna().any().any():
        raise ValueError("A fitted dynamic centroid is missing its lineage ID or RFM profile.")

    result = pd.concat([pd.DataFrame(baseline_rows), dynamic], ignore_index=True)
    result = result.sort_values(["stable_cluster_id", "cycle"]).reset_index(drop=True)
    if result["cycle"].min() != 0 or result["cycle"].max() != 9:
        raise ValueError("Centroid data must span Cycle 0 through Cycle 9.")
    return result


def save_fitted_centroid_plot(centroids: pd.DataFrame, output: Path) -> None:
    cluster_ids = sorted(centroids["stable_cluster_id"].unique())
    columns = min(3, len(cluster_ids))
    rows = math.ceil(len(cluster_ids) / columns)
    figure, axes = plt.subplots(
        rows,
        columns,
        figsize=(5.2 * columns, 3.3 * rows),
        sharex=False,
        sharey=False,
        squeeze=False,
    )
    axes = axes.flatten()

    for axis, cluster_id in zip(axes, cluster_ids):
        group = centroids.loc[centroids["stable_cluster_id"].eq(cluster_id)].sort_values("cycle")
        profile = group.iloc[-1]["model_profile"]
        axis.set_title(f"{cluster_id} · last observed: {profile}", fontsize=10, weight="bold")
        axis.grid(True, color="#E5E7EB", linewidth=0.8)
        axis.set_xlabel("PC1")
        axis.set_ylabel("PC2")
        axis.spines[["top", "right"]].set_visible(False)

        # Draw only adjacent-cycle steps. A retired or absent cluster should leave a gap.
        points = list(group.itertuples(index=False))
        x_span = max(float(group["PC1"].max() - group["PC1"].min()), 1e-12)
        y_span = max(float(group["PC2"].max() - group["PC2"].min()), 1e-12)
        for left, right in zip(points, points[1:]):
            if int(right.cycle) == int(left.cycle) + 1:
                axis.annotate(
                    "",
                    xy=(right.PC1, right.PC2),
                    xytext=(left.PC1, left.PC2),
                    arrowprops={"arrowstyle": "-", "color": "#A6ADB5", "linewidth": 1.5},
                    zorder=1,
                )
        labelled_indexes = set(range(len(points)))
        label_offsets = [(8, -12), (-10, 10), (8, 10), (-12, -12)]
        for point_index, point in enumerate(points):
            color = profile_color(point.model_profile)
            axis.scatter(point.PC1, point.PC2, color=color, s=38, edgecolor="white", linewidth=0.9, zorder=2)
            if point_index not in labelled_indexes:
                continue
            label_index = point_index % len(label_offsets)
            offset_x, offset_y = label_offsets[label_index]
            if point.PC1 >= float(group["PC1"].max()) - 0.08 * x_span:
                offset_x = -10
            elif point.PC1 <= float(group["PC1"].min()) + 0.08 * x_span:
                offset_x = 10
            if point.PC2 >= float(group["PC2"].max()) - 0.08 * y_span:
                offset_y = -10
            elif point.PC2 <= float(group["PC2"].min()) + 0.08 * y_span:
                offset_y = 10
            axis.annotate(
                f"C{int(point.cycle)}",
                (point.PC1, point.PC2),
                xytext=(offset_x, offset_y),
                textcoords="offset points",
                fontsize=7,
                color="#3F4750",
                ha="left" if offset_x > 0 else "right",
                va="bottom" if offset_y > 0 else "top",
                bbox={"facecolor": "white", "alpha": 0.75, "edgecolor": "none", "pad": 0.35},
            )

    for axis in axes[len(cluster_ids):]:
        axis.set_visible(False)

    present_profiles = sorted(centroids["model_profile"].dropna().unique(), key=profile_sort_key)
    family_legend = [
        Line2D(
            [0], [0], marker="o", linestyle="none", markerfacecolor=profile_color(profile),
            markeredgecolor="white", markersize=7, label=profile,
        )
        for profile in present_profiles
    ]
    figure.legend(
        handles=family_legend,
        loc="lower center",
        bbox_to_anchor=(0.5, 0.008),
        ncol=min(5, len(family_legend)),
        frameon=False,
    )
    figure.suptitle("PCA centroid movement by tracked cluster · Cycle 0 to Cycle 9", fontsize=16, weight="bold", y=0.99)
    figure.text(
        0.5,
        0.072,
        "Every point is a fitted centre in the shared Cycle 0 PCA space; C0–C9 label observed cycles.\n"
        "Lines connect adjacent cycles with the same provisional tracking ID; gaps mean the centre was absent.\n"
        "Point colours show the current weighted RFM profile. All observed customers enter each fit.\n"
        "Individual inactivity and risk are separate fields. Paths across all cycles can outnumber the centres present in one cycle.",
        ha="center",
        va="center",
        fontsize=8,
        color="#525B65",
        wrap=True,
    )
    figure.tight_layout(rect=(0.02, 0.18, 0.98, 0.94))
    # Place all cycle labels without overlapping earlier labels or plot borders.
    figure.canvas.draw()
    renderer = figure.canvas.get_renderer()
    candidates = [(8,8),(8,-12),(-8,8),(-8,-12),(0,18),(0,-21),(19,0),(-19,0),(14,22),(-14,-24)]
    for axis in axes[:len(cluster_ids)]:
        placed = []
        for label in [item for item in axis.texts if isinstance(item, Annotation) and item.get_text().startswith('C')]:
            choices = []
            for dx,dy in candidates:
                label.set_position((dx,dy))
                label.set_ha('left' if dx>0 else 'right' if dx<0 else 'center')
                label.set_va('bottom' if dy>=0 else 'top')
                bounds = label.get_window_extent(renderer).expanded(1.1,1.12)
                overlaps = sum(bounds.overlaps(other) for other in placed)
                outside = not axis.bbox.contains(bounds.x0,bounds.y0) or not axis.bbox.contains(bounds.x1,bounds.y1)
                choices.append((overlaps*10+int(outside)*3,abs(dx)+abs(dy),dx,dy))
            _,_,dx,dy = min(choices)
            label.set_position((dx,dy))
            label.set_ha('left' if dx>0 else 'right' if dx<0 else 'center')
            label.set_va('bottom' if dy>=0 else 'top')
            placed.append(label.get_window_extent(renderer).expanded(1.1,1.12))
    figure.savefig(output.with_suffix(".png"), dpi=240, bbox_inches="tight", facecolor="white")
    figure.savefig(output.with_suffix(".svg"), bbox_inches="tight", facecolor="white")
    plt.close(figure)


def save_profile_centroid_plot(centroids: pd.DataFrame, output: Path) -> None:
    """One panel per approved profile; points are actual centres, never group means."""
    present = [name for name in PROFILE_ORDER if centroids.model_profile.eq(name).any()]
    figure, axes = plt.subplots(math.ceil(len(present)/3), 3, figsize=(15.6, 3.75*math.ceil(len(present)/3)), squeeze=False)
    for axis, profile in zip(axes.flat, present):
        group = centroids.loc[centroids.model_profile.eq(profile)].sort_values('cycle')
        if group.cycle.duplicated().any():
            raise ValueError(f'A named profile has multiple centres in one cycle: {profile}')
        color = profile_color(profile)
        axis.set_title(profile, color=color, fontsize=11, weight='bold', pad=12)
        axis.set_xlabel('PC1'); axis.set_ylabel('PC2')
        axis.grid(True, color='#E5E7EB', linewidth=.8)
        axis.spines[['top','right']].set_visible(False)
        points = list(group.itertuples(index=False))
        for left, right in zip(points,points[1:]):
            if int(right.cycle) == int(left.cycle)+1:
                axis.plot([left.PC1,right.PC1],[left.PC2,right.PC2],color=color,linewidth=1.5,
                          linestyle='-' if left.stable_cluster_id==right.stable_cluster_id else '--')
        axis.scatter(group.PC1,group.PC2,color=color,s=44,edgecolors='white',linewidths=.8,zorder=3)
        # Alternate offset directions; collision checking happens after layout.
        for index,point in enumerate(points):
            axis.annotate(f'C{int(point.cycle)}',(point.PC1,point.PC2),xytext=(8 if index%2==0 else -8,10 if index%3 else -12),
                          textcoords='offset points',fontsize=8,ha='left' if index%2==0 else 'right',
                          bbox={'facecolor':'white','alpha':.8,'edgecolor':'none','pad':.25})
        axis.margins(.18,.20)
        missing=sorted(set(range(10))-set(group.cycle.astype(int)))
        note=f'{len(points)} observed centre position'+('s' if len(points)!=1 else '')
        if missing:
            runs=[];start=previous=missing[0]
            for number in missing[1:]:
                if number!=previous+1:
                    runs.append(f'C{start}' if start==previous else f'C{start}–C{previous}')
                    start=number
                previous=number
            runs.append(f'C{start}' if start==previous else f'C{start}–C{previous}')
            note+='; absent: '+', '.join(runs)
        axis.text(0,-.36,note,transform=axis.transAxes,fontsize=7.5,color='#525B65')
    for axis in list(axes.flat)[len(present):]:axis.set_visible(False)
    figure.suptitle('PCA centroid movement by named profile · Cycle 0 to Cycle 9',fontsize=17,weight='bold',y=.99)
    figure.legend(handles=[Line2D([0],[0],color='#505B65',label='Same tracking ID',linewidth=1.6),
                           Line2D([0],[0],color='#505B65',label='Different tracking ID; same profile name',linestyle='--',linewidth=1.6)],
                  loc='lower center',bbox_to_anchor=(.5,.035),ncol=2,frameon=False)
    figure.text(.5,.015,'Actual fitted centres in the common PCA space; each panel has its own axis range. Missing positions remain empty.',ha='center',fontsize=9,color='#525B65')
    figure.tight_layout(rect=(.015,.09,.985,.95),h_pad=3.7,w_pad=2.5)
    figure.canvas.draw();renderer=figure.canvas.get_renderer()
    offsets=[(8,10),(-8,10),(8,-12),(-8,-12),(0,20),(0,-23),(22,0),(-22,0)]
    for axis in list(axes.flat)[:len(present)]:
        placed=[]
        for label in [item for item in axis.texts if isinstance(item,Annotation) and item.get_text().startswith('C')]:
            choices=[]
            for dx,dy in offsets:
                label.set_position((dx,dy));label.set_ha('left' if dx>0 else 'right' if dx<0 else 'center');label.set_va('bottom' if dy>=0 else 'top')
                bounds=label.get_window_extent(renderer).expanded(1.1,1.1)
                outside=not axis.bbox.contains(bounds.x0,bounds.y0) or not axis.bbox.contains(bounds.x1,bounds.y1)
                choices.append((sum(bounds.overlaps(other) for other in placed)*10+int(outside)*3,abs(dx)+abs(dy),dx,dy))
            _,_,dx,dy=min(choices)
            label.set_position((dx,dy));label.set_ha('left' if dx>0 else 'right' if dx<0 else 'center');label.set_va('bottom' if dy>=0 else 'top')
            placed.append(label.get_window_extent(renderer).expanded(1.1,1.1))
    output.parent.mkdir(parents=True,exist_ok=True)
    figure.savefig(output.with_suffix('.png'),dpi=220,bbox_inches='tight',facecolor='white')
    figure.savefig(output.with_suffix('.svg'),bbox_inches='tight',facecolor='white')
    plt.close(figure)


def load_business_centroids(connection: sqlite3.Connection) -> pd.DataFrame:
    """Actual per-cycle mean positions of five named customer groups, never fabricated centres."""
    return pd.read_sql_query(
        """
        SELECT 0 AS cycle, Segment_Name AS segment, COUNT(*) AS customers,
               AVG(PC1) AS PC1, AVG(PC2) AS PC2, AVG(PC3) AS PC3,
               AVG(Recency) AS recency, AVG(Frequency) AS frequency, AVG(Monetary) AS monetary
        FROM Time_Cycle_0_Segmentation GROUP BY Segment_Name
        UNION ALL
        SELECT CAST(REPLACE(d.CycleID, 'Cycle_', '') AS INTEGER) AS cycle,
               d.Segment_Name AS segment, COUNT(*) AS customers,
               AVG(p.PC1) AS PC1, AVG(p.PC2) AS PC2, AVG(p.PC3) AS PC3,
               AVG(p.Recency) AS recency, AVG(p.Frequency) AS frequency, AVG(p.Monetary) AS monetary
        FROM Dynamic_Loop_Results d
        JOIN Data_Preprocessing_Results p ON p.CustomerID=d.CustomerID AND p.CycleID=d.CycleID
        GROUP BY d.CycleID, d.Segment_Name
        ORDER BY cycle, segment
        """, connection,
    )


def save_business_centroid_plot(centroids: pd.DataFrame, output: Path) -> None:
    """Five panels in business hierarchy, C0-C9 labels and adjacent-cycle connected observations."""
    figure, axes = plt.subplots(3, 2, figsize=(13.5, 13.5), squeeze=False)
    for axis, profile in zip(axes.flat, PROFILE_ORDER):
        group = centroids.loc[centroids["segment"].eq(profile)].sort_values("cycle")
        color = PROFILE_COLORS[profile]
        axis.set_title(profile, color=color, fontsize=14, weight="bold", pad=14)
        axis.set_xlabel("PC1")
        axis.set_ylabel("PC2")
        axis.grid(True, color="#E0E4E8", linewidth=0.8)
        axis.spines[["top", "right"]].set_visible(False)
        if group.empty:
            axis.text(0.5, 0.5, "No observed customers in Cycles 0–9", ha="center", transform=axis.transAxes)
            continue
        # Reindex introduces a real gap if a business group is absent in a cycle.
        sequence = group.set_index("cycle").reindex(range(10))
        axis.plot(sequence.PC1, sequence.PC2, color=color, linewidth=1.7, zorder=1)
        axis.scatter(group.PC1, group.PC2, color=color, s=52, edgecolors="white", linewidths=0.8, zorder=2)
        offsets = [(7, 8), (7, -13), (-8, 10), (-8, -13)]
        for index, point in enumerate(group.itertuples(index=False)):
            dx, dy = offsets[index % len(offsets)]
            axis.annotate(f"C{int(point.cycle)}", (point.PC1, point.PC2), xytext=(dx, dy),
                          textcoords="offset points", fontsize=8,
                          ha="left" if dx > 0 else "right", color="#303840",
                          bbox={"facecolor":"white", "alpha":0.78, "edgecolor":"none", "pad":0.3})
        axis.margins(x=0.18, y=0.20)
        missing = sorted(set(range(10)) - set(group.cycle.astype(int)))
        text = f"{len(group)} observed cycle means"
        if missing:
            text += "; no customers in " + ", ".join(f"C{cycle}" for cycle in missing)
        axis.text(0, -0.21, text, transform=axis.transAxes, fontsize=8, color="#59636E")
    axes.flat[-1].axis("off")
    axes.flat[-1].text(0.02, 0.8,
        "Each point is the mean PCA position of customers\nin the named business group for that cycle.\n\n"
        "All cycles use the same Cycle 0 scaler and PCA axes.\n"
        "C0–C9 identify cycles; lines connect consecutive observations.\n"
        "An absent group has no invented point.\n\n"
        "These business-group means are separate from fitted\nK-means / MDFCM centres. Customers may move between groups.\n"
        "Inactive customers have current Recency and zero current\nmonthly purchases, while prior memberships are retained.",
        transform=axes.flat[-1].transAxes, fontsize=10, color="#59636E", va="top", linespacing=1.6)
    figure.suptitle("PCA movement of the five customer groups · Cycle 0 to Cycle 9", fontsize=17, weight="bold", y=0.995)
    figure.tight_layout(rect=(0.02, 0.02, 0.98, 0.97), h_pad=3.7, w_pad=3.0)
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output.with_suffix(".png"), dpi=220, bbox_inches="tight", facecolor="white")
    figure.savefig(output.with_suffix(".svg"), bbox_inches="tight", facecolor="white")
    plt.close(figure)


def refresh_all_figures(connection: sqlite3.Connection, figure_root: Path) -> dict[str, int]:
    refresh_profile_figures(connection, figure_root)
    fitted = load_centroids(connection)
    named_output = figure_root / 'Dynamic' / 'centroid_movement_cycles_0_9'
    save_profile_centroid_plot(fitted,named_output)
    fitted.to_csv(named_output.with_suffix('.csv'),index=False)
    fitted_output = figure_root / 'Dynamic' / 'fitted_centroid_movement_cycles_0_9'
    save_fitted_centroid_plot(fitted,fitted_output)
    fitted.to_csv(fitted_output.with_suffix('.csv'),index=False)
    individual = figure_root / 'Dynamic' / 'Per_Cluster_Centroids'
    individual.mkdir(exist_ok=True)
    for profile,group in fitted.groupby('model_profile'):
        filename=''.join(character.lower() if character.isalnum() else '_' for character in profile).strip('_')
        group.to_csv(individual/(filename+'.csv'),index=False)
    return {"fitted_centre_observations": len(fitted), "tracked_clusters": int(fitted.stable_cluster_id.nunique())}



def refresh_profile_figures(connection: sqlite3.Connection, figure_root: Path) -> None:
    baseline = pd.read_sql_query(
        "SELECT Segment_Name, PC1, PC2 FROM Time_Cycle_0_Segmentation",
        connection,
    )
    figure_root.joinpath("Baseline").mkdir(parents=True, exist_ok=True)
    figure_root.joinpath("Dynamic").mkdir(parents=True, exist_ok=True)

    figure, axis = plt.subplots(figsize=(9, 6.5))
    for label in sorted(baseline["Segment_Name"].dropna().unique(), key=profile_sort_key):
        rows = baseline.loc[baseline["Segment_Name"].eq(label)]
        axis.scatter(
            rows["PC1"], rows["PC2"], s=23, alpha=0.75,
            color=profile_color(label), label=label, edgecolors="none",
        )
    axis.set_title("Cycle 0 behavioural customer clusters")
    axis.set_xlabel("Principal component 1")
    axis.set_ylabel("Principal component 2")
    axis.legend(frameon=False, ncol=2)
    axis.grid(True, color="#E5E7EB", linewidth=0.8)
    figure.tight_layout()
    figure.savefig(figure_root / "Baseline" / "cycle0_pca_clusters.png", dpi=220, bbox_inches="tight", facecolor="white")
    plt.close(figure)

    baseline_counts = (
        baseline.groupby("Segment_Name").size().rename("Customers").reset_index()
    )
    baseline_counts["Cycle"] = 0
    dynamic_counts = pd.read_sql_query(
        """
        SELECT CycleID, Segment_Name, COUNT(*) AS Customers
        FROM Dynamic_Customer_Summary
        GROUP BY CycleID, Segment_Name
        """,
        connection,
    )
    dynamic_counts["Cycle"] = dynamic_counts["CycleID"].str.replace("Cycle_", "", regex=False).astype(int)
    evolution = pd.concat(
        [baseline_counts[["Cycle", "Segment_Name", "Customers"]], dynamic_counts[["Cycle", "Segment_Name", "Customers"]]],
        ignore_index=True,
    )
    figure, axis = plt.subplots(figsize=(11, 6.5))
    for label in sorted(evolution["Segment_Name"].dropna().unique(), key=profile_sort_key):
        rows = evolution.loc[evolution["Segment_Name"].eq(label)].sort_values("Cycle")
        axis.plot(
            rows["Cycle"], rows["Customers"], marker="o", linewidth=2.1,
            color=profile_color(label), label=label,
        )
    axis.set_title("Behavioural segment evolution from Cycle 0 to Cycle 9")
    axis.set_xlabel("Cycle")
    axis.set_ylabel("Customers")
    axis.set_xticks(range(10))
    axis.grid(True, color="#E5E7EB", linewidth=0.8)
    axis.legend(frameon=False, ncol=2)
    figure.tight_layout()
    figure.savefig(figure_root / "Dynamic" / "segment_evolution_cycles_0_9.png", dpi=220, bbox_inches="tight", facecolor="white")
    plt.close(figure)

    transitions = pd.read_sql_query(
        'SELECT CycleID, Transition_Status AS state, COUNT(*) AS customers FROM Customer_Transitions GROUP BY CycleID,Transition_Status', connection)
    transitions['cycle'] = transitions.CycleID.str.replace('Cycle_','',regex=False).astype(int)
    counts = transitions.pivot(index='cycle',columns='state',values='customers').fillna(0)
    counts = counts.reindex(columns=['New','Existing Stable','Existing Migrated'],fill_value=0)
    axis = counts.plot(kind='bar',stacked=True,figsize=(12,6),color=['#9bd3ae','#0b7a4b','#e0a72f'])
    axis.set_title('Customer fitted assignment states')
    axis.set_xlabel('Cycle'); axis.set_ylabel('Customers')
    axis.legend(title='Assignment state',ncol=3)
    axis.figure.tight_layout()
    axis.figure.savefig(figure_root/'Dynamic'/'customer_transition_states.png',dpi=220,bbox_inches='tight',facecolor='white')
    plt.close(axis.figure)


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh family-coloured PCA figures from the repaired CSRS database.")
    parser.add_argument("--db", type=Path, required=True, help="Repaired SQLite database")
    parser.add_argument("--figure-root", type=Path, help="Research_Figures output directory (defaults beside the database)")
    args = parser.parse_args()
    if not args.db.is_file():
        raise FileNotFoundError(args.db)
    figure_root = args.figure_root or args.db.parent / "Research_Figures"
    connection = sqlite3.connect(args.db)
    try:
        summary = refresh_all_figures(connection, figure_root)
    finally:
        connection.close()
    print(f"Refreshed PCA figures under {figure_root}")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
