"""Check every persisted customer warning against its documented rule and history."""
import argparse
import json
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd


def audit(directory):
    connection=sqlite3.connect(directory/'csrs_pipeline_b_repaired.db')
    baseline=pd.read_sql_query('SELECT * FROM Time_Cycle_0_Segmentation',connection)
    baseline['CycleID']='Cycle_0'
    dynamic=pd.read_sql_query('SELECT * FROM Dynamic_Loop_Results',connection)
    features=pd.read_sql_query('SELECT CustomerID,CycleID,Recency,Frequency,Monetary,Activity_Status FROM Data_Preprocessing_Results',connection)
    labels=pd.concat([baseline,dynamic],ignore_index=True)
    labels=labels.drop(columns=[name for name in ['Recency','Frequency','Monetary','Activity_Status'] if name in labels])
    rows=labels.merge(features,on=['CustomerID','CycleID'],validate='one_to_one')
    rows['cycle_number']=rows.CycleID.str.replace('Cycle_','').astype(int)
    previous={}; errors=[]; distributions=[]; max_delta_error=0.
    for number,group in rows.sort_values(['cycle_number','CustomerID']).groupby('cycle_number',sort=True):
        for row in group.to_dict('records'):
            old=previous.get(row['CustomerID'])
            f=m=delta=np.nan
            if old is not None:
                f=row['Frequency']/old['Frequency']-1 if old['Frequency']>0 else np.nan
                m=row['Monetary']/old['Monetary']-1 if old['Monetary']>0 else np.nan
                if number>=2 and row['Stable_Cluster_ID']==old['Stable_Cluster_ID']:
                    family=row['Stable_Cluster_ID']
                    current_mass=sum(d['membership'] for d in json.loads(row['Fuzzy_Membership_Details']) if d['stable_cluster_id']==family)
                    previous_mass=sum(d['membership'] for d in json.loads(old['Fuzzy_Membership_Details']) if d['stable_cluster_id']==family)
                    delta=current_mass-previous_mass
            low_confidence=np.isfinite(delta) and delta<=-.10+1e-12 and (f<=-.25+1e-12 or m<=-.25+1e-12)
            declining_purchases=f<=-.50+1e-12 and m<=-.50+1e-12
            purchase_gap=row['Recency']>30
            expected=('Lost' if row['Recency']>90 else 'Slipping' if row['Recency']>60 else 'At risk' if low_confidence or declining_purchases or purchase_gap
                      else 'No prior comparison' if old is None else 'No risk flag')
            if expected!=row['Risk_Status']: errors.append([int(number),int(row['CustomerID']),expected,row['Risk_Status']])
            for name,wanted in [('Membership_Change',delta),('Frequency_Change_Ratio',f),('Monetary_Change_Ratio',m)]:
                stored=row[name]
                if pd.isna(wanted):
                    if not pd.isna(stored): errors.append([int(number),int(row['CustomerID']),name,'expected null'])
                elif pd.isna(stored) or abs(stored-wanted)>1e-10:
                    errors.append([int(number),int(row['CustomerID']),name,'numeric mismatch'])
                else: max_delta_error=max(max_delta_error,abs(stored-wanted))
            previous[row['CustomerID']]=row
        distributions.append({'cycle':f'Cycle_{number}','statuses':group.Risk_Status.value_counts().to_dict()})
    assert not errors, errors[:10]
    result={'scope':'Customer warning policy; not a churn-prediction accuracy claim','checked_customer_cycle_rows':len(rows),
            'incorrect_status_or_change_values':len(errors),'maximum_change_value_error':max_delta_error,
            'distributions':distributions,'passed':True}
    (directory/'customer_risk_audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    connection.close(); return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--run-dir',required=True,type=Path)
    args=parser.parse_args();print(json.dumps(audit(args.run_dir),indent=2))
