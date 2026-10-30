"""Deterministic synthetic branch checks; these are never research observations."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from csrs_model import dynamic_fuzzy_update, memberships_from_centroids


def audit() -> dict:
    centres = np.array([[-1., -1., 0.], [-1., 1., 0.], [1., -1., 0.], [1., 1., 0.]])
    rng = np.random.default_rng(20261025)
    ordinary = np.vstack([centre + rng.normal(0, .035, (35, 3)) for centre in centres])
    cases = [
        ("neither", ordinary, False, False, {4}),
        ("condition_1_only", np.vstack([ordinary, [0., 0., 0.]]), True, False, {3, 5}),
        ("condition_2_only", np.vstack([ordinary, [3., 0., 0.]]), False, True, {4, 5}),
        ("both", np.vstack([ordinary, [0., 0., 3.]]), True, True, {3, 4, 5}),
    ]
    results = []
    exercised_actions = set()
    for name, features, expected_1, expected_2, expected_k in cases:
        fitted = dynamic_fuzzy_update(features, centres, previous_cluster_mass=np.full(4, 35.))
        assert bool(fitted["condition_1_met"]) == expected_1, (name, "condition 1")
        assert bool(fitted["condition_2_met"]) == expected_2, (name, "condition 2")
        candidates = fitted["candidate_details"]
        assert {int(k) for k in candidates} == expected_k, (name, "candidate set")
        assert fitted["selected_k"] == min(expected_k, key=lambda k: candidates[str(k)]["xie_beni"])
        for candidate in candidates.values():
            assert candidate["converged"] and np.isfinite(candidate["xie_beni"])
            assert candidate["objective_change"] <= .01 + 1e-12
            exercised_actions.add(candidate["initialization_action"])
        memberships = fitted["memberships"]
        assert np.allclose(memberships.sum(axis=1), 1., atol=1e-10)
        # Independently recompute membership from inverse squared distances for m=2.
        d2 = ((features[:, None, :] - fitted["centroids"][None, :, :]) ** 2).sum(axis=2)
        inverse = 1. / np.maximum(d2, 1e-30)
        expected_memberships = inverse / inverse.sum(axis=1, keepdims=True)
        assert np.allclose(memberships, expected_memberships, atol=1e-10)
        objective = float(np.sum(memberships ** 2 * d2))
        assert abs(objective - fitted["objective"]) < 1e-9
        results.append({"case": name, "condition_1": expected_1, "condition_2": expected_2,
                        "evaluated_k": sorted(expected_k), "selected_k": fitted["selected_k"],
                        "candidate_xb": fitted["candidate_xb"], "passed": True})
    assert exercised_actions == {"incremental_center_movement", "eliminate_one_cluster", "split_one_cluster"}
    exact, _ = memberships_from_centroids(centres[:1], centres, 2.)
    assert np.array_equal(exact[0], [1., 0., 0., 0.])
    return {"scope": "Synthetic verification only; excluded from research database, metrics and plots",
            "cases": results, "exercised_actions": sorted(exercised_actions), "passed": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit()
    if args.output:
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
