"""Check baseline preservation, current-population coverage and commercial units."""
import argparse
import ast
import hashlib
import json
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd


def audit(run, reference):
    columns=['CustomerID','Recency','Frequency','Monetary','Log_R','Log_F','Log_M','RF_Score','RM_Score','FM_Score','PC1','PC2','PC3','KMeans_Cluster_Number']
    with sqlite3.connect(reference/'csrs_pipeline_b_repaired.db') as old, sqlite3.connect(run/'csrs_pipeline_b_repaired.db') as db:
        baseline_query='SELECT '+','.join('p.'+c for c in columns[:-1])+', b.KMeans_Cluster_Number FROM Data_Preprocessing_Results p JOIN Time_Cycle_0_Segmentation b ON p.CustomerID=b.CustomerID WHERE p.CycleID="Cycle_0" ORDER BY p.CustomerID'
        prior=pd.read_sql_query(baseline_query,old)
        baseline=pd.read_sql_query(baseline_query,db)
        error=float(np.abs(prior.to_numpy(float)-baseline.to_numpy(float)).max())
        assert error < 1e-12, error
        preprocessing=pd.read_sql_query('SELECT * FROM Data_Preprocessing_Results',db)
        dynamics=pd.read_sql_query('SELECT * FROM Dynamic_Loop_Results',db)
        registry=pd.read_sql_query('SELECT * FROM Current_Cluster_Profiles',db)
        summaries=pd.read_sql_query('SELECT * FROM Dynamic_Cycle_Summary',db)
        cycle_checks=[]
        for cycle,rows in preprocessing.groupby('CycleID',sort=False):
            if cycle=='Cycle_0':continue
            fitted=dynamics.loc[dynamics.CycleID.eq(cycle)]
            entries=registry.loc[registry.CycleID.eq(cycle)]
            assert set(rows.CustomerID)==set(fitted.CustomerID)
            assert not fitted.CustomerID.duplicated().any() and fitted.Is_Model_Fit.eq(1).all()
            assert fitted.Assignment_Mode.eq('Current-cycle fuzzy fit').all()
            assert entries.displayLabel.nunique()==len(entries)
            assert int(entries.hardWinnerCustomers.sum())==len(rows)
            assert set(fitted.Stable_Cluster_ID).issubset(set(entries.stableClusterId))
            cycle_checks.append({'cycle':cycle,'observed_customers':len(rows),'fitted_customers':len(fitted),'monthly_non_purchasers_fitted':int(fitted.Activity_Status.eq('Inactive').sum()),'fitted_k':len(entries),'distinct_display_names':int(entries.displayLabel.nunique())})
        assert summaries.HistoricalMembershipMassUsed.eq(0).all()
        period_sales=float(preprocessing.Current_Period_Revenue.sum())
        period_orders=float(preprocessing.Current_Period_Orders.sum())
        # Reuse the independently reconstructed source total, not a model result.
        source_audit=json.loads((run/'preprocessing_audit.json').read_text())
        assert source_audit['status']=='passed'
        source_sales=float(source_audit['cleaning']['qualifying_paid_sales'])
        reference_orders=float(old.execute('SELECT SUM(Frequency*Frequency_Monetary_Period_Months) FROM Data_Preprocessing_Results').fetchone()[0])
        assert abs(period_sales-source_sales)<.01,(period_sales,source_sales)
        assert abs(period_orders-reference_orders)<1e-8
        assert int(preprocessing.CustomerID.nunique())==4297 and len(preprocessing)==30280
    module=Path(__file__).with_name('csrs_model.py')
    tree=ast.parse(module.read_text(encoding='utf-8'))
    lock=json.loads(module.with_name('reporting_change_computation_lock_20261025.json').read_text())
    unchanged={}
    for node in tree.body:
        if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in lock['function_ast_sha256']:
            digest=hashlib.sha256(ast.dump(node,include_attributes=False).encode()).hexdigest()
            unchanged[node.name]=digest==lock['function_ast_sha256'][node.name]
    assert all(unchanged.values()),unchanged
    report={'passed':True,'cycle0_maximum_numeric_change':error,'core_function_ast_unchanged':unchanged,
            'fit_policy':'Every observed customer contributes exactly one current replacement snapshot; no historical snapshot is added as another observation.',
            'historical_membership_mass_used':0,'customer_cycle_rows':len(preprocessing),'distinct_customers':4297,
            'disjoint_period_paid_sales':period_sales,'disjoint_period_orders':int(period_orders),'cycles':cycle_checks}
    (run/'population_scope_audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--run-dir',type=Path,required=True);p.add_argument('--reference',type=Path,required=True)
    print(json.dumps(audit(p.parse_args().run_dir,p.parse_args().reference),indent=2))
