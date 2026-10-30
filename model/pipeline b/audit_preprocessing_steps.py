"""Independent reconstruction of CSRS cleaning, snapshots, feature transforms and geographic predictions.

This audit intentionally does not import csrs_model or call its processing functions.
Run after a model rebuild: python audit_preprocessing_steps.py --run-dir <run folder>
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import time

import joblib
import numpy as np
import pandas as pd

FEATURES = ["Log_R", "Log_F", "Log_M", "RF_Score", "RM_Score", "FM_Score"]
SCALED = ["Scaled_" + name for name in FEATURES]
PC = ["PC1", "PC2", "PC3"]
SOURCE_COLUMNS = ["InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate", "UnitPrice", "CustomerID", "Country"]
GEO_FEATURES = ["Log_Customer_Count", "Log_Revenue", "Log_Orders_Per_Customer", "Log_Revenue_Per_Customer", "Log_Product_Diversity", "Repeat_Purchase_Rate", "Champions_Share", "Loyalists_Share", "Mid_Tier_Occasionals_Share", "Developing_Share", "Hibernating_Lost_Share", "Other_Customer_Segment_Share"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def max_error(left, right) -> float:
    a = np.asarray(left, dtype=float)
    b = np.asarray(right, dtype=float)
    if a.shape != b.shape:
        raise AssertionError(f"Array shapes disagree: {a.shape}, {b.shape}")
    if not np.isfinite(a).all() or not np.isfinite(b).all():
        raise AssertionError("Unexpected non-finite values in numeric audit")
    return float(np.max(np.abs(a - b))) if a.size else 0.0


def checked_error(left, right, tolerance: float, label: str) -> float:
    residual = max_error(left, right)
    if residual > tolerance:
        raise AssertionError(f"{label}: residual {residual} exceeds {tolerance}")
    return residual


def independent_clean(source: Path) -> tuple[pd.DataFrame, dict]:
    original = pd.read_excel(source, usecols=SOURCE_COLUMNS)
    frame = original.drop_duplicates(subset=SOURCE_COLUMNS).copy()
    duplicate_count = len(original) - len(frame)
    invoice = frame.InvoiceNo.fillna("").map(str).str.strip()
    date = pd.to_datetime(frame.InvoiceDate, errors="coerce")
    customer = pd.to_numeric(frame.CustomerID, errors="coerce")
    quantity = pd.to_numeric(frame.Quantity, errors="coerce")
    price = pd.to_numeric(frame.UnitPrice, errors="coerce")
    customer_values = customer.to_numpy(dtype=float)
    mask = (
        np.isfinite(customer_values) & (np.mod(customer_values, 1) == 0)
        & (customer_values >= -(2.0 ** 63)) & (customer_values < 2.0 ** 63)
        & invoice.ne("") & date.ge("2010-12-01") & date.lt("2011-12-01")
        & np.isfinite(quantity) & quantity.gt(0) & np.isfinite(price) & price.gt(0)
        & ~invoice.str.upper().str.startswith("C")
    )
    cleaned = frame.loc[mask].copy()
    cleaned["InvoiceNo"] = invoice.loc[mask]
    cleaned["InvoiceDate"] = date.loc[mask]
    cleaned["CustomerID"] = customer.loc[mask].astype("int64")
    cleaned["Quantity"] = quantity.loc[mask].astype(float)
    cleaned["UnitPrice"] = price.loc[mask].astype(float)
    cleaned["StockCode"] = cleaned.StockCode.map(str).str.strip()
    cleaned["Description"] = cleaned.Description.fillna("Unknown product").map(str).str.strip()
    cleaned["Country"] = cleaned.Country.fillna("Unspecified").map(str).str.strip()
    cleaned["PaidSales"] = cleaned.Quantity * cleaned.UnitPrice
    audit = {
        "raw_rows": int(len(original)), "exact_duplicates_removed_all_source_dates": int(duplicate_count),
        "deduplicated_rows_all_source_dates": int(len(frame)),
        "qualifying_rows": int(len(cleaned)), "qualifying_customers": int(cleaned.CustomerID.nunique()),
        "qualifying_paid_sales": float(cleaned.PaidSales.sum()),
        "invalid_or_out_of_period_rows_after_deduplication": int((~mask).sum()),
        "policy": "Exact source-row deduplication; valid integer CustomerID, nonblank invoice, valid date in [2010-12-01,2011-12-01), finite positive quantity and unit price, non-cancellation invoices. Missing product description/country use explicit placeholders.",
    }
    return cleaned, audit


def verify_snapshots(clean: pd.DataFrame, stored: pd.DataFrame, cycle_table: pd.DataFrame) -> dict:
    first = clean.groupby("CustomerID").InvoiceDate.min()
    all_expected = []
    result = {"rows_checked": int(len(stored)), "cycles": []}
    for number in range(10):
        start = pd.Timestamp("2010-12-01") if number == 0 else pd.Timestamp("2011-03-01") + pd.DateOffset(months=number - 1)
        end = pd.Timestamp("2011-03-01") if number == 0 else start + pd.DateOffset(months=1)
        months = 3
        window_start = end - pd.Timedelta(days=90)
        cycle = f"Cycle_{number}"
        definition = cycle_table.loc[cycle_table.CycleID.eq(cycle)].iloc[0]
        assert int(definition.CycleNumber) == number
        for column, expected_date in [("PeriodStart",start),("PeriodEnd",end),("WindowStart",window_start),("SnapshotDate",end)]:
            assert pd.Timestamp(definition[column]) == expected_date, (cycle,column)
        eligible = first.loc[first < end].index
        history = clean.loc[clean.InvoiceDate < end]
        period = clean.loc[clean.InvoiceDate.ge(start) & clean.InvoiceDate.lt(end)]
        window = history.loc[history.InvoiceDate.ge(window_start)]
        latest = history.groupby("CustomerID").InvoiceDate.max()
        expected = pd.DataFrame(index=eligible)
        expected["Recency"] = (end.normalize() - latest.reindex(eligible).dt.normalize()).dt.days
        expected["Frequency"] = window.groupby("CustomerID").InvoiceNo.nunique().reindex(eligible,fill_value=0) / months
        expected["Monetary"] = window.groupby("CustomerID").PaidSales.sum().reindex(eligible,fill_value=0) / months
        expected["Products"] = window.groupby("CustomerID").Description.nunique().reindex(eligible,fill_value=0) / months
        expected["Quantity"] = window.groupby("CustomerID").Quantity.sum().reindex(eligible,fill_value=0) / months
        expected["Has_Purchase_In_Recency_Window"] = latest.reindex(eligible).ge(window_start).astype(int)
        expected["Is_New"] = (first.reindex(eligible).ge(start) & first.reindex(eligible).lt(end)).astype(int)
        expected["Current_Period_Orders"] = period.groupby("CustomerID").InvoiceNo.nunique().reindex(eligible,fill_value=0)
        expected["Current_Period_Revenue"] = period.groupby("CustomerID").PaidSales.sum().reindex(eligible,fill_value=0)
        expected["Current_Period_Products"] = period.groupby("CustomerID").Description.nunique().reindex(eligible,fill_value=0)
        expected["Current_Period_Quantity"] = period.groupby("CustomerID").Quantity.sum().reindex(eligible,fill_value=0)
        expected["Is_Model_Fit"] = 1
        expected["Activity_Status"] = np.where(expected.Current_Period_Orders > 0,"Active","Inactive")
        expected["Lifecycle_Status"] = np.where(expected.Recency > 90,"Hibernating / Lost","Within 90-day window")
        actual = stored.loc[stored.CycleID.eq(cycle)].set_index("CustomerID").sort_index()
        expected = expected.sort_index()
        assert expected.index.equals(actual.index), f"Customer population mismatch in {cycle}"
        residuals = {}
        for field in ["Recency","Frequency","Monetary","Products","Quantity","Has_Purchase_In_Recency_Window","Is_New","Is_Model_Fit","Current_Period_Orders","Current_Period_Revenue","Current_Period_Products","Current_Period_Quantity"]:
            residuals[field] = checked_error(expected[field], actual[field], 1e-7 if field in ["Monetary", "Current_Period_Revenue"] else 1e-10, f"{cycle} {field}")
        for field in ["Activity_Status","Lifecycle_Status"]:
            assert (expected[field] == actual[field]).all(), (cycle,field)
        for field, expected_date in [("Cycle_End_Date",end),("Window_Start_Date",window_start),("Frequency_Monetary_Period_Start",window_start),("Frequency_Monetary_Period_End",end)]:
            assert pd.to_datetime(actual[field]).eq(expected_date).all(), (cycle,field)
        assert actual.Frequency_Monetary_Period_Months.eq(months).all()
        assert pd.to_datetime(actual.FirstPurchaseDate).eq(first.reindex(actual.index)).all()
        assert pd.to_datetime(actual.LatestPurchaseDate).eq(latest.reindex(actual.index)).all()
        result["cycles"].append({"cycle":number,"customers":len(actual),"active":int(expected.Current_Period_Orders.gt(0).sum()),"hibernating":int(expected.Recency.gt(90).sum()),"maximum_absolute_residuals":residuals})
        expected["CycleID"] = cycle
        all_expected.append(expected.reset_index())
    expected_keys = pd.concat(all_expected).set_index(["CycleID","CustomerID"])
    assert expected_keys.index.is_unique
    assert len(expected_keys)==len(stored)
    result["all_snapshot_fields_match"] = True
    result["definition_note"] = "Exact Recency is uncapped. F/M use exact trailing90-day totals dividedby3 in every cycle. Current_Period commercialfields use only nonoverlapping currentperiod transactions. Every customer observed before the snapshot enters fitting exactlyonce."
    return result


def verify_transforms(stored: pd.DataFrame, run: Path) -> dict:
    r = np.log1p(stored.Recency.to_numpy(float))
    f = np.log1p(stored.Frequency.to_numpy(float))
    m = np.log1p(stored.Monetary.to_numpy(float))
    manual_features = np.column_stack([r,f,m,r*f,r*m,f*m])
    feature_errors = {name:checked_error(manual_features[:,index],stored[name],1e-11,name) for index,name in enumerate(FEATURES)}
    scaler = joblib.load(run / "cycle0_feature_scaler.pkl")
    baseline_mask = stored.CycleID.eq("Cycle_0").to_numpy()
    baseline = manual_features[baseline_mask]
    minimum,maximum = baseline.min(axis=0),baseline.max(axis=0)
    span = maximum-minimum
    divisor = np.where(span==0,1.0,span)
    manual_scaled = (manual_features-minimum) / divisor
    assert int(scaler.n_samples_seen_) == len(baseline)
    assert int(scaler.n_features_in_)==6
    assert scaler.feature_range==(0,1)
    assert not scaler.clip
    scaler_errors = {
        "data_min":checked_error(minimum,scaler.data_min_,1e-12,"scaler minima"),
        "data_max":checked_error(maximum,scaler.data_max_,1e-12,"scaler maxima"),
        "data_range":checked_error(span,scaler.data_range_,1e-12,"scaler ranges"),
        "scale":checked_error(1/divisor,scaler.scale_,1e-12,"scaler scale"),
        "all_stored_scaled_features":checked_error(manual_scaled,stored[SCALED],1e-11,"scaled values"),
    }
    pca = joblib.load(run / "cycle0_pca_model.pkl")
    baseline_scaled = manual_scaled[baseline_mask]
    expected_mean = baseline_scaled.mean(axis=0)
    assert int(pca.n_samples_)==len(baseline_scaled)
    assert int(pca.n_components_)==3
    centered = baseline_scaled-expected_mean
    _, singular, vt = np.linalg.svd(centered,full_matrices=False)
    variance = singular**2/(len(centered)-1)
    manual_pc = (manual_scaled-expected_mean) @ pca.components_.T
    pca_errors = {
        "baseline_mean":checked_error(expected_mean,pca.mean_,1e-12,"PCA mean"),
        "orthonormality":checked_error(pca.components_@pca.components_.T,np.eye(3),1e-12,"PCA orthonormality"),
        "explained_variance":checked_error(variance[:3],pca.explained_variance_,1e-12,"PCA variance"),
        "principal_subspace_projector":checked_error(vt[:3].T@vt[:3],pca.components_.T@pca.components_,1e-11,"PCA subspace"),
        "all_stored_PC_coordinates":checked_error(manual_pc,stored[PC],1e-11,"PCA positions"),
    }
    return {"features_checked":FEATURES,"feature_maximum_absolute_residuals":feature_errors,"scaler_fit_rows":int(scaler.n_samples_seen_),"scaler_maximum_absolute_residuals":scaler_errors,"pca_fit_rows":int(pca.n_samples_),"pca_maximum_absolute_residuals":pca_errors,"pca_explained_variance_ratio":pca.explained_variance_ratio_.tolist(),"dynamic_scaled_cells_outside_baseline_0_1_range":int(((manual_scaled[~baseline_mask]<0)|(manual_scaled[~baseline_mask]>1)).sum()),"feature_definition":"log1p(R), log1p(F), log1p(M), then products of the corresponding logged values for RF/RM/FM. Scaler and PCA are fitted only on Cycle 0 and reused without clipping dynamic values."}


def verify_geography(connection: sqlite3.Connection, run: Path) -> dict:
    frame = pd.read_sql_query("SELECT * FROM Geographic_Market_Features ORDER BY CycleID, Country",connection)
    segmentation = pd.read_sql_query("SELECT CycleID,Country,Geographic_Cluster_Number FROM Geographic_Segmentation ORDER BY CycleID,Country",connection)
    metadata = json.loads((run/"model_metadata.json").read_text(encoding="utf-8"))
    assert metadata["geographic_features"]==GEO_FEATURES
    baseline_mask=frame.CycleID.eq("Cycle_0").to_numpy()
    x=frame[GEO_FEATURES].to_numpy(float)
    baseline=x[baseline_mask]
    centre=np.median(baseline,axis=0)
    q25,q75=np.percentile(baseline,[25,75],axis=0)
    spread=q75-q25
    spread=np.where(spread < 10*np.finfo(float).eps,1.0,spread)
    manual=(x-centre)/spread
    scaler=joblib.load(run/"cycle0_geographic_scaler.pkl")
    kmeans=joblib.load(run/"cycle0_geographic_kmeans.pkl")
    assert int(kmeans.n_clusters)==3 and int(kmeans.n_init)==50 and int(kmeans.random_state)==42
    errors={
        "robust_baseline_median":checked_error(centre,scaler.center_,1e-12,"geographic scaler median"),
        "robust_baseline_interquartile_range":checked_error(spread,scaler.scale_,1e-12,"geographic scaler spread"),
        "all_stored_scaled_values":checked_error(manual,frame[["Scaled_"+field for field in GEO_FEATURES]],1e-11,"geographic scaled values"),
    }
    distances=((manual[:,None,:]-kmeans.cluster_centers_[None,:,:])**2).sum(axis=2)
    raw=distances.argmin(axis=1)
    mapping={}
    for raw_id in range(3):
        matched=frame.loc[baseline_mask & (raw==raw_id),"Geographic_Cluster_Number"].unique()
        assert len(matched)==1,"Baseline market label mapping is not one-to-one"
        mapping[raw_id]=int(matched[0])
    assert set(mapping.values())=={0,1,2}
    expected=np.array([mapping[int(value)] for value in raw])
    label_mismatches=int(np.count_nonzero(expected != frame.Geographic_Cluster_Number.to_numpy()))
    assert label_mismatches==0
    assert frame[["CycleID","Country"]].equals(segmentation[["CycleID","Country"]])
    assert np.array_equal(expected,segmentation.Geographic_Cluster_Number)
    base_profiles=frame.loc[baseline_mask].assign(raw=raw[baseline_mask]).groupby("raw").agg(revenue=("Revenue","sum"),sales_per_customer=("Revenue_Per_Customer","mean"))
    dominant=int(base_profiles.revenue.idxmax())
    remaining=set(range(3))-{dominant}
    highest=int(base_profiles.loc[list(remaining)].sales_per_customer.idxmax())
    other=int(next(iter(remaining-{highest})))
    assert mapping=={dominant:0,highest:1,other:2},"Market names do not agree with documented baseline profiles"
    shares=frame[["Champions_Share","Loyalists_Share","Mid_Tier_Occasionals_Share","Developing_Share","Hibernating_Lost_Share","Other_Customer_Segment_Share"]]
    errors["business_profile_share_sum"]=checked_error(shares.sum(axis=1),np.ones(len(frame)),1e-12,"market profile shares")
    return {"rows_checked":len(frame),"baseline_fit_markets":int(baseline_mask.sum()),"k":3,"label_mismatches":label_mismatches,"raw_to_descriptive_number":mapping,"maximum_absolute_residuals":errors,"method":"Cycle 0 RobustScaler median/IQR and K-means K=3 with n_init=50, seed42; frozen scaler and nearest fitted centre in all later cycles. Aggregate At_Risk_Share is excluded from the feature matrix."}


def verify_source_storage(connection: sqlite3.Connection, clean: pd.DataFrame, run: Path) -> dict:
    summary=json.loads((run/"model_validation_summary.json").read_text(encoding="utf-8"))
    assert int(summary["clean_transactions"])==len(clean)
    assert int(summary["customers"])==clean.CustomerID.nunique()
    customers=pd.read_sql_query("SELECT CustomerID, FirstPurchaseDate, LastPurchaseDate FROM Customer ORDER BY CustomerID",connection)
    expected=clean.groupby("CustomerID").InvoiceDate.agg(["min","max"]).sort_index()
    assert np.array_equal(expected.index,customers.CustomerID)
    assert pd.to_datetime(customers.FirstPurchaseDate).to_numpy().tolist()==expected["min"].to_numpy().tolist()
    assert pd.to_datetime(customers.LastPurchaseDate).to_numpy().tolist()==expected["max"].to_numpy().tolist()
    actual=pd.read_sql_query("SELECT "+",".join(SOURCE_COLUMNS)+",Total_Price FROM Dynamic_Business_Analytics",connection)
    expected=clean.loc[clean.InvoiceDate.ge("2011-03-01")].copy()
    assert len(actual)==len(expected)
    for frame in [expected,actual]:
        frame["InvoiceDate"]=pd.to_datetime(frame.InvoiceDate)
        frame["CustomerID"]=frame.CustomerID.astype("int64")
        frame["Quantity"]=frame.Quantity.astype(float)
        frame["UnitPrice"]=frame.UnitPrice.astype(float)
        for field in ["InvoiceNo","StockCode","Description","Country"]:
            frame[field]=frame[field].astype(str)
    left=np.sort(pd.util.hash_pandas_object(expected[SOURCE_COLUMNS],index=False).to_numpy())
    right=np.sort(pd.util.hash_pandas_object(actual[SOURCE_COLUMNS],index=False).to_numpy())
    assert np.array_equal(left,right),"Dynamic business rows do not match the cleaned raw March-November source multiset"
    residual=checked_error(actual.Quantity.to_numpy()*actual.UnitPrice.to_numpy(),actual.Total_Price.to_numpy(),1e-10,"stored sales")
    return {"customer_master_rows":len(customers),"dynamic_source_transaction_rows_matched":len(actual),"entire_source_row_multiset_matches":True,"stored_total_price_maximum_absolute_residual":residual}


def audit(run: Path, source: Path) -> dict:
    started=time.perf_counter()
    clean,cleaning=independent_clean(source)
    print(f"Independent cleaning: {len(clean)} paid-sale rows, {clean.CustomerID.nunique()} customers",flush=True)
    database=run/"csrs_pipeline_b_repaired.db"
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
        stored=pd.read_sql_query("SELECT * FROM Data_Preprocessing_Results ORDER BY PreprocessID",connection)
        cycles=pd.read_sql_query("SELECT * FROM Cycle_Definitions ORDER BY CycleNumber",connection)
        source_storage=verify_source_storage(connection,clean,run)
        snapshots=verify_snapshots(clean,stored,cycles)
        print(f"Independently reconstructed every field in {len(stored)} customer-cycle snapshots",flush=True)
        transforms=verify_transforms(stored,run)
        geography=verify_geography(connection,run)
    return {"status":"passed","run_directory":str(run),"database_sha256":sha256(database),"source_path":str(source),"source_sha256":sha256(source),"audit_seconds":round(time.perf_counter()-started,3),"independence":"No imports of production csrs_model and no calls to its cleaning, snapshot, feature or transformation functions. Raw source reconstructed directly; fitted parameter attributes independently checked against baseline raw features; all stored rows compared.","cleaning":cleaning,"source_storage":source_storage,"snapshots":snapshots,"transforms":transforms,"geography":geography}


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir",type=Path,required=True)
    parser.add_argument("--source",type=Path,default=Path(__file__).resolve().parent/"Online UK_Retail.xlsx")
    args=parser.parse_args()
    report=audit(args.run_dir.resolve(),args.source.resolve())
    target=args.run_dir/"preprocessing_audit.json"
    target.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    print(json.dumps({"status":report["status"],"output":str(target),"rows":report["snapshots"]["rows_checked"],"audit_seconds":report["audit_seconds"]}),flush=True)


if __name__=="__main__":
    main()

