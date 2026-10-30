"""Version an existing fitted run and apply approved reporting names only."""
from __future__ import annotations
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import numpy as np
import pandas as pd
from cluster_labels import public_profile_name, PROFILE_ORDER, PROFILE_COLORS, PROFILE_DESCRIPTIONS, LABEL_POLICY, LEGACY_NAMES
from cluster_reporting import install_current_reporting

LABEL_COLUMNS = {'Segment_Name','Model_Profile_Name','Previous_Segment_Name','Previous_Model_Profile_Name','Firmographic_Segment_Name','businessProfile','displayLabel','storedBusinessProfile'}
DETAIL_COLUMNS = {'Fuzzy_Membership_Details','Previous_Fuzzy_Membership_Details'}


def quoted(text):
    return '"'+text.replace('"','""')+'"'


def numerical_signature(db):
    """Hash all original model numeric fields, identity and membership vectors."""
    digest=hashlib.sha256()
    tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    for table in tables:
        if table in {'Current_Cluster_Profiles','Current_Model_Quality','Model_Metadata'}: continue
        schema=list(db.execute('PRAGMA table_info('+quoted(table)+')'))
        columns=[row[1] for row in schema if row[2].upper() in {'INTEGER','REAL'} or row[1] in {'CycleID','Stable_Cluster_ID','Previous_Stable_Cluster_ID','CurrentStableClusterID','PreviousStableClusterID','All_Fuzzy_Memberships','Previous_All_Fuzzy_Memberships','Initial_Centroids','Updated_Centroids'}]
        digest.update(table.encode())
        if columns:
            for row in db.execute('SELECT '+','.join(map(quoted,columns))+' FROM '+quoted(table)+' ORDER BY rowid'):
                digest.update(json.dumps(row,allow_nan=False,separators=(',',':')).encode())
    return digest.hexdigest()


def rename_text(value):
    if value is None: return value
    text=str(value)
    if text.startswith('Champions · '): return 'High-Value Regulars'
    if text in LEGACY_NAMES: return LEGACY_NAMES[text]
    # Firmographic labels contain a geographic prefix and a descriptive name.
    if 'Champions · ' in text:
        return text[:text.index('Champions · ')]+'High-Value Regulars'
    for old,new in sorted(LEGACY_NAMES.items(),key=lambda item:-len(item[0])):
        if text.endswith(' '+old): return text[:-len(old)]+new
    return public_profile_name(text)


def rename_details(value):
    if value is None: return None
    details=json.loads(value)
    for item in details:
        if 'segment_name' in item:item['segment_name']=public_profile_name(item['segment_name'])
    return json.dumps(details)


def rename_run(source):
    source=source.resolve()
    target=source.parent/('named_'+datetime.now().strftime('%Y%m%d_%H%M%S'))
    if target.exists(): raise FileExistsError(target)
    shutil.copytree(source,target,ignore=shutil.ignore_patterns('local_backend*','local_runtime_status.json','previous_local_config.env'))
    source_db=source/'csrs_pipeline_b_repaired.db';target_db=target/source_db.name
    with sqlite3.connect(source_db.resolve().as_uri()+'?mode=ro',uri=True) as db: before=numerical_signature(db)
    changes={}
    with sqlite3.connect(target_db) as db:
        tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for table in tables:
            columns={row[1] for row in db.execute('PRAGMA table_info('+quoted(table)+')')}
            for column in sorted(columns & (LABEL_COLUMNS|DETAIL_COLUMNS)):
                transform=rename_details if column in DETAIL_COLUMNS else rename_text
                updates=[]
                for rowid,value in db.execute('SELECT rowid,'+quoted(column)+' FROM '+quoted(table)):
                    new=transform(value)
                    if new!=value:updates.append((new,rowid))
                if updates:
                    db.executemany('UPDATE '+quoted(table)+' SET '+quoted(column)+'=? WHERE rowid=?',updates)
                    changes[f'{table}.{column}']=len(updates)
        db.execute('UPDATE Model_Metadata SET MetadataValue=? WHERE MetadataKey=?',(LABEL_POLICY,'ReportingLabelPolicy'))
        assert numerical_signature(db)==before,'A numerical model field changed during renaming'
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    metadata=json.loads((target/'model_metadata.json').read_text(encoding='utf-8'))
    metadata.update({'reporting_label_policy':LABEL_POLICY,'profile_order':PROFILE_ORDER,'profile_colors':PROFILE_COLORS,'profile_descriptions':PROFILE_DESCRIPTIONS,'source_fitted_run':str(source),'reporting_revision':'Approved descriptive names and per-cluster diagnostics; no refitting.'})
    (target/'model_metadata.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    install_current_reporting(target)
    with sqlite3.connect(source_db.resolve().as_uri()+'?mode=ro',uri=True) as old,sqlite3.connect(target_db) as new:
        assert numerical_signature(new)==before
        key=['CycleID','localIndex']; fields=['PC1','PC2','PC3','hardWinnerCustomers','fuzzyMembershipMass','weightedRecency','weightedFrequency','weightedMonetary','winnerMeanMembership']
        a=pd.read_sql_query('SELECT * FROM Current_Cluster_Profiles',old).set_index(key).sort_index()
        b=pd.read_sql_query('SELECT * FROM Current_Cluster_Profiles',new).set_index(key).sort_index()
        assert np.allclose(a[fields].to_numpy(float),b[fields].to_numpy(float),rtol=0,atol=1e-12,equal_nan=True)
        q0=pd.read_sql_query('SELECT * FROM Current_Model_Quality',old).sort_values('cycleNumber')
        q1=pd.read_sql_query('SELECT * FROM Current_Model_Quality',new).sort_values('cycleNumber')
        numeric=['SelectedK','ModelFitCustomers','Inertia','SilhouetteScore','DaviesBouldinScore','CalinskiHarabaszScore','FuzzyObjective','XieBeniIndex','AverageMembership']
        assert np.allclose(q0[numeric].to_numpy(float),q1[numeric].to_numpy(float),rtol=0,atol=1e-10,equal_nan=True)
    model_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.glob('*.pkl')}
    assert all(hashlib.sha256((target/name).read_bytes()).hexdigest()==value for name,value in model_hashes.items())
    manifest={'passed':True,'source_run':str(source),'renamed_run':str(target),'numerical_model_signature_before':before,'numerical_model_signature_after':before,'assignments_memberships_centres_RFM_and_model_parameters_unchanged':True,'cycle_quality_metrics_unchanged':True,'new_per_cluster_diagnostics':True,'model_file_sha256':model_hashes,'changed_reporting_columns':changes,'approved_names':PROFILE_ORDER,'descriptions':PROFILE_DESCRIPTIONS}
    (target/'naming_update_audit.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    from export_evaluation_figures import export as export_evaluation_figures
    export_evaluation_figures(target)
    return target


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-run',type=Path,required=True)
    print(rename_run(p.parse_args().source_run))
