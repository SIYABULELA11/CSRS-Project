"""Report quality within observed cohorts using the same saved fit; never refit."""
import argparse
import json
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import silhouette_score


def audit(run):
    rows=[]
    with sqlite3.connect(run/'csrs_pipeline_b_repaired.db') as connection:
        data=pd.read_sql_query('SELECT p.CycleID,p.Recency,p.PC1,p.PC2,p.PC3,d.Cluster_Local_Index,d.Highest_Membership_Score,d.Activity_Status FROM Data_Preprocessing_Results p JOIN Dynamic_Loop_Results d ON p.CycleID=d.CycleID AND p.CustomerID=d.CustomerID',connection)
    for cycle,frame in data.groupby('CycleID'):
        for name,mask in [('All observed',np.ones(len(frame),dtype=bool)),('Purchased this month',frame.Activity_Status.eq('Active')),('Purchase within 90 days',frame.Recency.le(90)),('More than 90 days',frame.Recency.gt(90))]:
            subset=frame.loc[mask];labels=subset.Cluster_Local_Index.to_numpy();points=subset[['PC1','PC2','PC3']].to_numpy()
            valid=1<len(set(labels))<len(subset)
            rows.append({'CycleID':cycle,'scope':name,'customers':len(subset),'occupied_labels':len(set(labels)),
                'silhouette':float(silhouette_score(points,labels)) if valid else None,
                'mean_max_membership':float(subset.Highest_Membership_Score.mean()) if len(subset) else None})
    report={'available':True,'method':'Subset diagnostics keep the same fitted centres and saved assignments. They are descriptive comparisons, not independently fitted alternative models. Silhouette is unavailable for a cohort occupying only one label. Membership is not a calibrated probability.',
            'rows':rows,'latestCycle':'Cycle_9','latest':[row for row in rows if row['CycleID']=='Cycle_9']}
    (run/'population_quality_diagnostics.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    pd.DataFrame(rows).to_csv(run/'population_quality_diagnostics.csv',index=False)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--run-dir',type=Path,required=True)
    print(json.dumps(audit(p.parse_args().run_dir)['latest'],indent=2))
