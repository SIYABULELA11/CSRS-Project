"""Transparent descriptive labels for fitted centres; never changes assignments.

Labels describe the u**2 weighted RFM profile (crisp means for K-means).
They are not individual customer rules or ground-truth classes. A constrained
minimum-cost matching gives distinct suitable names where possible. If learned
centres outnumber suitable categories, a local-centre qualifier preserves the
actual K instead of inventing a category or merging numerical clusters.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

INTERNAL_PROFILE_ORDER = [
    "Champions", "Champions at Risk", "Loyalists", "Loyalist at Risk", "Mid-Tier Occasional",
    "Occasional at Risk", "Developing", "Developing at Risk", "Hibernating / Lost",
]
PROFILE_ORDER = [
    "Champions", "High-Value Regulars", "Loyalists", "Valuable Customers at Risk",
    "Mid-Tier Occasionals", "Occasional Buyers at Risk", "Light Buyers",
    "Light Buyers at Risk", "Hibernating / Lost",
]
PROFILE_COLORS = dict(zip(PROFILE_ORDER, [
    "#087F5B", "#004D40", "#123B73", "#45A6E5", "#C46A00", "#B84E35",
    "#6B3FA0", "#C86EAB", "#6D7480",
]))
LEGACY_NAMES = {
    "Champions at Risk": "Valuable Customers at Risk",
    "Loyalist at Risk": "Valuable Customers at Risk",
    "Mid-Tier Occasional": "Mid-Tier Occasionals",
    "Occasional at Risk": "Occasional Buyers at Risk",
    "Developing": "Light Buyers",
    "Developing at Risk": "Light Buyers at Risk",
}
PROFILE_DESCRIPTIONS = {
    "Champions": "The freshest high-value repeat-purchase profile.",
    "High-Value Regulars": "Strong repeat purchasing and spending with a slightly longer purchase gap than the freshest Champions profile.",
    "Loyalists": "A recent, moderate-value repeat-purchase profile.",
    "Valuable Customers at Risk": "Meaningful rolling-window purchasing value with a longer purchase gap; this does not establish a previous Loyalists assignment.",
    "Mid-Tier Occasionals": "Recent purchasing with moderate value and less frequent ordering than the strongest repeat-purchase profiles.",
    "Occasional Buyers at Risk": "Infrequent purchasing with a substantial purchase gap.",
    "Light Buyers": "Relatively low-frequency, lower-spending customers who purchased recently; growth is not assumed.",
    "Light Buyers at Risk": "A light purchasing profile with a longer purchase gap.",
    "Hibernating / Lost": "Predominantly customers without purchases for more than 90 days; individuals can differ from the weighted profile.",
}


# Relative frequency/spend ranks, then typical purchase gap in days.
# These are disclosed reporting prototypes, not fitted model parameters.
PROTOTYPES = {
    "Champions": (1.0, 1.0, 7.0),
    "Champions at Risk": (1.0, 1.0, 60.0),
    "Loyalists": (0.80, 0.65, 12.0),
    "Loyalist at Risk": (0.80, 0.65, 60.0),
    "Mid-Tier Occasional": (0.50, 0.50, 30.0),
    "Occasional at Risk": (0.50, 0.50, 60.0),
    "Developing": (0.15, 0.15, 15.0),
    "Developing at Risk": (0.15, 0.15, 70.0),
    "Hibernating / Lost": (0.0, 0.0, 120.0),
}
LABEL_POLICY = (
    "The approved public names describe the existing fitted profiles without changing numerical clustering. "
    "Profiles use u^2-weighted raw RFM (crisp means in Cycle 0), relative F/M ranks and the existing "
    "minimum-cost descriptive prototype matching. Champions, High-Value Regulars, Loyalists and Light "
    "Buyers have weighted Recency <=30; Mid-Tier Occasionals <=60; the At Risk profiles have "
    "30<Recency<=90; Hibernating / Lost has Recency>90. The additional recent high-value Champions "
    "centre is named High-Value Regulars. Names describe current profiles, not proven prior-group "
    "origins or calibrated churn probabilities. Each fitted centre stays distinct; no centre, "
    "membership, assignment, PCA coordinate, outlier or performance metric is altered by renaming."
)


def public_profile_name(name: str) -> str:
    text = str(name or "")
    if text.startswith("Champions · "):
        return "High-Value Regulars"
    parts = text.split(" · ", 1)
    result = LEGACY_NAMES.get(parts[0], parts[0])
    return result + (" · " + parts[1] if len(parts) > 1 else "")


def base_profile(name: str) -> str:
    return public_profile_name(name).split(" · ")[0]


def profile_color(name: str) -> str:
    return PROFILE_COLORS.get(base_profile(name), "#9a9a9a")


def profile_sort_key(name: str) -> tuple[int, str]:
    base = base_profile(name)
    return (PROFILE_ORDER.index(base) if base in PROFILE_ORDER else len(PROFILE_ORDER), str(name))


def centre_profiles(snapshot, labels, centroids=None, fuzzy_memberships=None):
    labels = np.asarray(labels, dtype=int)
    k = len(centroids) if centroids is not None else int(labels.max()) + 1
    if fuzzy_memberships is None:
        weights = np.eye(k)[labels]
    else:
        membership = np.asarray(fuzzy_memberships, dtype=float)
        if membership.shape[0] != len(snapshot):
            raise ValueError("Label profiles and current fitted population differ")
        k = membership.shape[1]
        weights = membership ** 2
    mass = weights.sum(axis=0)
    if (mass <= 0).any():
        raise ValueError("Cannot name a centre without any observed membership weight")
    values = snapshot[["Recency", "Frequency", "Monetary"]].to_numpy(float)
    profiles = pd.DataFrame(weights.T @ values / mass[:, None], columns=["Recency", "Frequency", "Monetary"])
    eligible = profiles.Recency.le(90)
    for field in ["Frequency", "Monetary"]:
        profiles[field + "Rank"] = 0.0
        profiles.loc[eligible, field + "Rank"] = profiles.loc[eligible, field].rank(method="average", pct=True)
    return profiles


def _eligible(name: str, recency: float) -> bool:
    if name == "Hibernating / Lost":
        return recency > 90
    if "at Risk" in name:
        return 30 < recency <= 90
    return recency <= (60 if name == "Mid-Tier Occasional" else 30)


def assign_cluster_names(snapshot, labels, centroids=None, fuzzy_memberships=None) -> dict[int, str]:
    profiles = centre_profiles(snapshot, labels, centroids, fuzzy_memberships)
    k = len(profiles)
    # Each row also has a private fallback column; impossible labels never win.
    cost = np.full((k, len(INTERNAL_PROFILE_ORDER) + k), 1e9)
    closest = {}
    for local, row in profiles.iterrows():
        suitable = []
        for column, name in enumerate(INTERNAL_PROFILE_ORDER):
            if not _eligible(name, float(row.Recency)):
                continue
            f, m, r = PROTOTYPES[name]
            score = (0.45 * (row.FrequencyRank - f) ** 2
                     + 0.40 * (row.MonetaryRank - m) ** 2
                     + 0.15 * ((min(row.Recency, 180) - r) / 90) ** 2)
            cost[local, column] = score
            suitable.append((score, column, name))
        if not suitable:
            raise ValueError(f"No suitable reporting category for centre {local}")
        closest[local] = min(suitable)[2]
        cost[local, len(INTERNAL_PROFILE_ORDER) + local] = 10.0
    rows, columns = linear_sum_assignment(cost)
    internal_names = {
        int(local): (INTERNAL_PROFILE_ORDER[column] if column < len(INTERNAL_PROFILE_ORDER)
                     else f"{closest[local]} · centre {local + 1}")
        for local, column in zip(rows, columns)
    }

    result = {}
    used = set()
    for local, internal in internal_names.items():
        public = public_profile_name(internal)
        if public in used:
            public += f" · centre {local + 1}"
        used.add(public)
        result[local] = public
    return result
