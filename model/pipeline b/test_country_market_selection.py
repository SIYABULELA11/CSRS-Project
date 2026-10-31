"""Country-market checks; behavioural fitting is deliberately not executed."""
import sqlite3
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import RobustScaler
from threadpoolctl import threadpool_limits

from csrs_model import (
    GEOGRAPHIC_FEATURE_COLUMNS,
    GEOGRAPHIC_SEGMENTS,
    order_geographic_clusters,
    select_geographic_k,
)


class CountryMarketSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = Path(__file__).resolve().parents[2] / "deployment/current/csrs_pipeline_b_repaired.db"
        if not cls.db.exists():
            raise unittest.SkipTest("Current deployment database is not prepared")
        with sqlite3.connect(cls.db.as_uri() + "?mode=ro", uri=True) as connection:
            cls.features = pd.read_sql_query(
                "SELECT * FROM Geographic_Market_Features ORDER BY CycleID, Country", connection
            )
        cls.baseline = cls.features.loc[cls.features.CycleID.eq("Cycle_0")].copy()
        cls.scaler = RobustScaler().fit(cls.baseline[GEOGRAPHIC_FEATURE_COLUMNS])
        cls.scaled = cls.scaler.transform(cls.baseline[GEOGRAPHIC_FEATURE_COLUMNS])
        with threadpool_limits(limits=1):
            cls.model, cls.candidates, cls.selection = select_geographic_k(cls.scaled)

    def test_only_commercial_features_enter_fit(self):
        self.assertEqual(len(GEOGRAPHIC_FEATURE_COLUMNS), 6)
        self.assertFalse(any("Share" in feature for feature in GEOGRAPHIC_FEATURE_COLUMNS))
        self.assertEqual(self.model.n_features_in_, 6)

    def test_selection_reproduces_six_feature_elbow_and_disagreement(self):
        self.assertEqual(self.candidates.K.tolist(), list(range(2, 11)))
        self.assertEqual(int(self.candidates.Selected.sum()), 1)
        self.assertEqual(self.selection["selectedK"], 4)
        self.assertEqual(self.selection["silhouetteBestK"], 3)
        selected = self.candidates.loc[self.candidates.Selected.eq(1)].iloc[0]
        self.assertAlmostEqual(selected.Inertia, 46.548789, places=5)
        self.assertAlmostEqual(selected.SilhouetteScore, 0.295778, places=5)
        self.assertEqual(sorted(np.bincount(self.model.labels_)), [1, 2, 13, 13])

    def test_names_follow_commercial_profiles_not_arbitrary_raw_ids(self):
        mapping, _ = order_geographic_clusters(self.baseline, self.model.labels_)
        names = pd.Series(self.model.labels_, index=self.baseline.Country).map(mapping).map(GEOGRAPHIC_SEGMENTS)
        self.assertEqual(names["United Kingdom"], "UK-Dominated Market")
        self.assertEqual(names["EIRE"], "High-Spend-per-Customer Markets")
        self.assertEqual(names["Netherlands"], "High-Spend-per-Customer Markets")
        permutation = {raw: 10 + 3 * raw for raw in mapping}
        shuffled = np.array([permutation[int(raw)] for raw in self.model.labels_])
        shuffled_mapping, _ = order_geographic_clusters(self.baseline, shuffled)
        shuffled_names = pd.Series(shuffled, index=self.baseline.Country).map(shuffled_mapping).map(GEOGRAPHIC_SEGMENTS)
        pd.testing.assert_series_equal(names, shuffled_names)

    def test_later_prediction_keeps_reference_scaling_and_centres(self):
        before_centres = self.model.cluster_centers_.copy()
        before_centre = self.scaler.center_.copy()
        before_scale = self.scaler.scale_.copy()
        latest = self.features.loc[self.features.CycleID.eq("Cycle_9")]
        transformed = self.scaler.transform(latest[GEOGRAPHIC_FEATURE_COLUMNS])
        labels = self.model.predict(transformed)
        nearest = np.square(transformed[:, None, :] - before_centres[None, :, :]).sum(axis=2).argmin(axis=1)
        np.testing.assert_array_equal(labels, nearest)
        np.testing.assert_array_equal(self.model.cluster_centers_, before_centres)
        np.testing.assert_array_equal(self.scaler.center_, before_centre)
        np.testing.assert_array_equal(self.scaler.scale_, before_scale)

    def test_invalid_feature_space_is_rejected(self):
        with self.assertRaises(ValueError):
            select_geographic_k(np.zeros((29, 12)))
        bad = self.scaled.copy()
        bad[0, 0] = np.nan
        with self.assertRaises(ValueError):
            select_geographic_k(bad)


if __name__ == "__main__":
    unittest.main()
