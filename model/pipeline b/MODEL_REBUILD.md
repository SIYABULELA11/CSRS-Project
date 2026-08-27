# Corrected CSRS model rebuild

This folder contains the reproducible model implementation used by `csrs_B.ipynb`.

## Corrections implemented

- Uses a cumulative customer universe instead of active customers only.
- Calculates behavioural features in fixed three-month rolling windows.
- Fits the feature scaler and PCA model on Cycle 0 only.
- Reuses the saved Cycle 0 preprocessing models for Cycles 1 to 10.
- Separates new, stable, migrated, inactive, and reactivated customers.
- Calculates the fuzzy objective and Xie-Beni index for every dynamic cycle.
- Segments geographic markets using country-level commercial and behavioural features.
- Creates firmographic customer-market segments by combining behavioural and geographic segments.
- Precomputes Cycle 10 for safe playback by the deployed interface.

## Rebuild

Create and activate a Python environment, install `requirements-model.txt`, then run:

```powershell
python rebuild_model.py
```

The rebuild replaces `csrs_pipeline_b.db`, updates saved preprocessing models, and recreates the corrected research figures. The previous active-only figures are removed from the working tree and remain available through Git history. The old notebook is retained as `csrs_B_Legacy_Active_Only.ipynb` for audit purposes.
