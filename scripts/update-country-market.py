"""Refresh only country markets and their behavioural cross-classification.

Creates a new versioned run; never refits behavioural customers or edits its source run.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import RobustScaler
from threadpoolctl import threadpool_limits

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'model/pipeline b'))
import csrs_model as model
from export_evaluation_figures import export as export_evaluation
from refresh_methodology_diagram import create_diagram

CHANGED_TABLES = {'Geographic_Market_Features','Geographic_Segmentation','Geographic_Cycle_Summary',
                  'Firmographic_Customer_Segmentation','Geographic_K_Selection','Model_Metadata'}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def table_hashes(connection):
    result = {}
    for (table,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        if table in CHANGED_TABLES:
            continue
        digest = hashlib.sha256()
        cursor = connection.execute('SELECT * FROM "' + table.replace('"','""') + '"')
        count = 0
        for row in cursor:
            digest.update(json.dumps(row, ensure_ascii=False, allow_nan=False).encode('utf-8'))
            digest.update(b'\n')
            count += 1
        result[table] = {'rows':count,'sha256':digest.hexdigest()}
    return result

def update(source, target, desktop=None):
    source, target = source.resolve(), target.resolve()
    if target.exists():
        raise FileExistsError('Choose a new run directory; existing results are never overwritten')
    source_db = source/'csrs_pipeline_b_repaired.db'
    source_hash = sha(source_db)
    with sqlite3.connect(source_db.as_uri()+'?mode=ro',uri=True) as con:
        unchanged_before = table_hashes(con)
        features = pd.read_sql_query('SELECT * FROM Geographic_Market_Features ORDER BY CycleID,Country',con)
        integrated = pd.read_sql_query('SELECT * FROM Firmographic_Customer_Segmentation',con)
        metadata_rows = pd.read_sql_query('SELECT * FROM Model_Metadata',con)
    shutil.copytree(source,target,ignore=shutil.ignore_patterns('*.log','*.pid','*.env','previous_local_config.env','local_*','render_*','service_audit.json'))
    db = target/'csrs_pipeline_b_repaired.db'
    features = features.drop(columns=[c for c in features if c.startswith('Scaled_')])
    baseline = features.loc[features.CycleID.eq('Cycle_0')].sort_values('Country').copy()
    scaler = RobustScaler().fit(baseline[model.GEOGRAPHIC_FEATURE_COLUMNS])
    with threadpool_limits(limits=1):
        kmeans,candidates,selection = model.select_geographic_k(scaler.transform(baseline[model.GEOGRAPHIC_FEATURE_COLUMNS]))
    assert kmeans.n_clusters == 4, 'Current accepted evidence should select four country-market groups'
    mapping,profiles = model.order_geographic_clusters(baseline,kmeans.labels_)
    transformed = scaler.transform(features[model.GEOGRAPHIC_FEATURE_COLUMNS])
    labels = kmeans.predict(transformed)
    features['Geographic_Cluster_Number'] = [mapping[int(label)] for label in labels]
    features['Geographic_Segment_Name'] = features.Geographic_Cluster_Number.map(model.GEOGRAPHIC_SEGMENTS)
    for i,column in enumerate(model.GEOGRAPHIC_FEATURE_COLUMNS):
        features['Scaled_'+column] = transformed[:,i]
    summaries=[]
    for cycle,part in features.groupby('CycleID',sort=True):
        X=part[['Scaled_'+c for c in model.GEOGRAPHIC_FEATURE_COLUMNS]].to_numpy(float)
        labels=kmeans.predict(X)
        metrics=model.safe_cluster_metrics(X,labels)
        wcss=float(((X-kmeans.cluster_centers_[labels])**2).sum())
        summaries.append(dict(CycleID=cycle,Markets=len(part),SelectedK=kmeans.n_clusters,
                              OccupiedGroups=len(np.unique(labels)),WCSS=wcss,
                              SilhouetteScore=metrics['silhouette'],DaviesBouldinScore=metrics['davies_bouldin'],
                              CalinskiHarabaszScore=metrics['calinski_harabasz']))
    cycle_summary=pd.DataFrame(summaries)
    segment_columns=['CycleID','Country','Geographic_Cluster_Number','Geographic_Segment_Name','Customer_Count',
                     'Active_Customer_Count','Revenue','Orders','Product_Diversity','Orders_Per_Customer',
                     'Revenue_Per_Customer','Repeat_Purchase_Rate','Champions_Share','Loyalists_Share',
                     'Mid_Tier_Occasionals_Share','Developing_Share','Hibernating_Lost_Share','At_Risk_Share']
    segmentation=features[segment_columns].copy()
    original_integrated_columns=list(integrated.columns)
    retained=integrated.drop(columns=['Geographic_Cluster_Number','Geographic_Segment_Name','Firmographic_Segment_Name'])
    combined=retained.merge(features[['CycleID','Country','Geographic_Cluster_Number','Geographic_Segment_Name']],
                            on=['CycleID','Country'],how='left',validate='many_to_one')
    assert len(combined)==len(integrated) and combined.Geographic_Segment_Name.notna().all()
    combined['Firmographic_Segment_Name']=[model.firmographic_name(g,b) for g,b in zip(combined.Geographic_Segment_Name,combined.Segment_Name)]
    combined=combined[original_integrated_columns]
    geographic_method=("Six commercial country-market inputs only: log1p customer count, 90-day paid sales, invoices per active customer, "
        "sales per active customer, product diversity; plus repeat-purchase rate. Cycle 0 RobustScaler and K-means (50 starts, seed 42), "
        "WCSS elbow among K=2-10 selects K=4; silhouette and commercial profiles support interpretation, not a claim of maximum silhouette. "
        "Later cycles reuse the baseline scaler and nearest centres. Behavioural shares are contextual outputs, excluded from the country fit. No country-market PCA.")
    definition=("Country-market and customer behavioural integration: cross-classify each customer's behavioural profile with the "
        "commercial country-market group assigned to their as-of country. This is a joined analytical view, not another clustering fit "
        "and not firmographic inference about company size, industry or ownership.")
    selection['fitCycle']='Cycle_0'
    selection['features']=model.GEOGRAPHIC_FEATURE_COLUMNS
    selection['selection']={'primary':'WCSS elbow','elbowK':selection['selectedK'],
        'highestSilhouetteK':selection['silhouetteBestK'],'rationale':selection['interpretationNote']}
    replacements={'FirmographicDefinition':definition,'GeographicKPolicy':model.GEOGRAPHIC_K_POLICY,
                  'GeographicMethod':geographic_method,'GeographicFeatures':json.dumps(model.GEOGRAPHIC_FEATURE_COLUMNS),
                  'GeographicSelectedK':str(kmeans.n_clusters),'GeographicKSelection':json.dumps(selection),
                  'CountryMarketBehaviouralIntegration':definition}
    for key,value in replacements.items():
        if metadata_rows.MetadataKey.eq(key).any():
            metadata_rows.loc[metadata_rows.MetadataKey.eq(key),'MetadataValue']=value
        else:
            metadata_rows.loc[len(metadata_rows)]={'MetadataKey':key,'MetadataValue':value}
    with sqlite3.connect(db) as con:
        for table,frame in [('Geographic_Market_Features',features),('Geographic_Segmentation',segmentation),
                            ('Geographic_Cycle_Summary',cycle_summary),('Firmographic_Customer_Segmentation',combined),
                            ('Geographic_K_Selection',candidates),('Model_Metadata',metadata_rows)]:
            frame.to_sql(table,con,if_exists='replace',index=False)
        con.execute('CREATE INDEX IF NOT EXISTS idx_firmographic_cycle_customer ON Firmographic_Customer_Segmentation(CycleID,CustomerID)')
        assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert table_hashes(con)==unchanged_before, 'A behavioural or preprocessing table changed'
    joblib.dump(scaler,target/'cycle0_geographic_scaler.pkl')
    joblib.dump(kmeans,target/'cycle0_geographic_kmeans.pkl')
    meta=json.loads((target/'model_metadata.json').read_text(encoding='utf-8'))
    meta.update(geographic_features=model.GEOGRAPHIC_FEATURE_COLUMNS,geographic_segments=model.GEOGRAPHIC_SEGMENTS,
                geographic_method=geographic_method,geographic_k_policy=model.GEOGRAPHIC_K_POLICY,
                geographic_k_selection=selection,geographic_cluster_mapping=mapping,firmographic_definition=definition,
                country_market_revision={'run':target.name,'sourceRun':source.name,'behaviouralResultsUnchanged':True})
    (target/'model_metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    model.save_geographic_selection_evidence(candidates,selection,target)
    profiles.to_csv(target/'country_market_baseline_profiles.csv',index=False)
    features.to_csv(target/'country_market_profiles_all_cycles.csv',index=False)
    cycle_summary.to_csv(target/'country_market_metrics_all_cycles.csv',index=False)
    render_market_figures(target,features,combined)
    create_diagram(target/'Research_Figures')
    evaluation=export_evaluation(target)
    # Their underlying behavioural rows are unchanged; preserve the original figures byte-for-byte.
    for stem in ['evaluation_cycle0_kmeans','evaluation_metrics_cycles_0_9','evaluation_metrics_cycles_1_9']:
        for extension in ['png','svg']:
            original=source/'Research_Figures/Validation'/f'{stem}.{extension}'
            if original.exists():
                shutil.copy2(original,target/'Research_Figures/Validation'/original.name)
    validation=json.loads((target/'model_validation_summary.json').read_text(encoding='utf-8'))
    validation.update(country_market_selected_k=kmeans.n_clusters,
                      firmographic_segments_cycle_9=int(combined.loc[combined.CycleID.eq('Cycle_9'),'Firmographic_Segment_Name'].nunique()),
                      country_market_update_run=target.name)
    (target/'model_validation_summary.json').write_text(json.dumps(validation,indent=2),encoding='utf-8')
    assert sha(source_db)==source_hash
    audit={'passed':True,'sourceRun':source.name,'sourceDatabaseSha256':source_hash,'updatedRun':target.name,
           'selectedK':kmeans.n_clusters,'features':model.GEOGRAPHIC_FEATURE_COLUMNS,'cycles':len(cycle_summary),
           'cycle0Markets':len(baseline),'cycle0Inertia':float(kmeans.inertia_),
           'cycle0Silhouette':float(cycle_summary.iloc[0].SilhouetteScore),
           'retainedCustomerCycleRows':len(combined),'latestCustomers':int(combined.loc[combined.CycleID.eq('Cycle_9'),'CustomerID'].nunique()),
           'latestMarketBehaviourCombinations':int(combined.loc[combined.CycleID.eq('Cycle_9'),'Firmographic_Segment_Name'].nunique()),
           'baselineGroups':profiles.to_dict('records'),'unchangedTables':unchanged_before,
           'behaviouralParametersUnchanged':all(sha(target/name)==sha(source/name) for name in ['cycle0_feature_scaler.pkl','cycle0_pca_model.pkl','cycle0_kmeans_model.pkl']),
           'sourceRunUnchanged':True,'geographicMetricVerification':evaluation['validation']}
    assert audit['behaviouralParametersUnchanged']
    (target/'country_market_update_audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
    write_note(target,audit,selection,cycle_summary)
    if desktop:
        desktop=desktop.resolve()
        desktop.mkdir(parents=True,exist_ok=True)
        for folder in ['Geographic','Market_Behavioural_Integration','Methodology','Validation']:
            shutil.copytree(target/'Research_Figures'/folder,desktop/folder,dirs_exist_ok=True)
        for name in ['COUNTRY_MARKET_UPDATE.md','country_market_k_selection.csv','country_market_k_selection.json',
                     'country_market_baseline_profiles.csv','country_market_profiles_all_cycles.csv',
                     'country_market_metrics_all_cycles.csv','country_market_update_audit.json']:
            shutil.copy2(target/name,desktop/name)
    print(json.dumps({k:audit[k] for k in ['passed','updatedRun','selectedK','cycle0Markets','cycle0Inertia','cycle0Silhouette','latestCustomers','latestMarketBehaviourCombinations','behaviouralParametersUnchanged']},indent=2))

def render_market_figures(target,features,combined):
    import matplotlib.pyplot as plt
    geo=target/'Research_Figures/Geographic'
    integration=target/'Research_Figures/Market_Behavioural_Integration'
    integration.mkdir(parents=True,exist_ok=True)
    def save(fig,path):
        fig.tight_layout()
        for ext in ['png','svg']:
            fig.savefig(path.with_suffix('.'+ext),dpi=200,bbox_inches='tight',facecolor='white')
        plt.close(fig)
    latest=features.loc[features.CycleID.eq('Cycle_9')]
    counts=latest.groupby('Geographic_Segment_Name').size().reindex(model.GEOGRAPHIC_SEGMENTS.values(),fill_value=0)
    fig,ax=plt.subplots(figsize=(12,5))
    ax.barh(counts.index[::-1],counts.values[::-1],color=[model.GEOGRAPHIC_COLORS[n] for n in counts.index[::-1]])
    ax.set(title='Cycle 9 country-market groups',xlabel='Recorded country markets')
    save(fig,geo/'cycle9_market_segments')
    grouped=features.groupby(['CycleID','Geographic_Segment_Name']).size().unstack(fill_value=0)
    fig,ax=plt.subplots(figsize=(13,6))
    for name in model.GEOGRAPHIC_SEGMENTS.values():
        ax.plot(range(10),grouped.reindex(columns=[name],fill_value=0)[name],'-o',label=name,color=model.GEOGRAPHIC_COLORS[name])
    ax.set(title='Country-market group membership across cycles',xlabel='Cycle',ylabel='Recorded country markets',xticks=range(10))
    ax.legend(fontsize=8)
    ax.grid(alpha=.2)
    save(fig,geo/'market_segment_evolution')
    latest_combined=combined.loc[combined.CycleID.eq('Cycle_9')]
    matrix=pd.crosstab(latest_combined.Geographic_Segment_Name,latest_combined.Segment_Name).reindex(index=model.GEOGRAPHIC_SEGMENTS.values(),columns=model.PROFILE_ORDER,fill_value=0)
    fig,ax=plt.subplots(figsize=(15,6))
    image=ax.imshow(matrix.to_numpy(),cmap='Greens',aspect='auto')
    ax.set_yticks(range(len(matrix)),matrix.index)
    ax.set_xticks(range(len(matrix.columns)),matrix.columns,rotation=35,ha='right')
    for i in range(len(matrix)):
        for j in range(len(matrix.columns)):
            value=int(matrix.iloc[i,j]);ax.text(j,i,str(value),ha='center',va='center',fontsize=9,color='white' if value>matrix.to_numpy().max()*.5 else '#173e30')
    ax.set_title('Cycle 9: country-market groups and customer behavioural profiles')
    fig.colorbar(image,ax=ax,label='Customers')
    save(fig,integration/'cycle9_market_behaviour_matrix')
    matrix.to_csv(integration/'cycle9_market_behaviour_matrix.csv')
    fig,ax=plt.subplots(figsize=(12,9))
    top=latest_combined.groupby('Firmographic_Segment_Name').size().sort_values().tail(15)
    ax.barh(top.index,top.values,color='#08745d')
    ax.set(title='Cycle 9 market–behaviour combinations',xlabel='Customers')
    save(fig,integration/'cycle9_market_behaviour_segments')
    # Legacy filename retained for existing artifact links; the rendered title uses current terminology.
    shutil.copy2(integration/'cycle9_market_behaviour_segments.png',target/'Research_Figures/Firmographic/cycle9_firmographic_segments.png')

def write_note(target,audit,selection,summary):
    lines=['# Country-market segmentation and behavioural integration','',
           'The country-market model now fits six commercial inputs only: customer count, paid sales, invoices per active customer, sales per active customer, distinct product-description count and repeat-purchase rate. The first five use log1p; all six use the Cycle 0 RobustScaler. Behavioural profile shares remain contextual outputs, not fit inputs. There is no country-market PCA.','',
           f"Cycle 0 evaluates K=2–10 with 50 K-means starts and seed 42. The normalized WCSS endpoint-chord elbow selects K={audit['selectedK']}; inertia is {audit['cycle0Inertia']:.4f} and silhouette is {audit['cycle0Silhouette']:.4f}. Silhouette instead favours K={selection['silhouetteBestK']} ({selection['silhouetteBestScore']:.4f}). The elbow is shallow and the UK singleton is disclosed. Interpretation supports reporting the selected groups; labels do not determine numeric fitting.",'',
           'The four baseline labels are UK-Dominated Market, High-Spend-per-Customer Markets, Higher-Repeat Overseas Markets and Lower-Volume Occasional-Purchase Markets. These are relative baseline descriptions, not country-wide economic classifications or permanent guarantees. Later cycles assign the current country features to the same saved centres using the same scaler; no later-country refit or MDFCM is performed.','',
           'For integration, each customer-cycle is joined to their country as known at that cutoff, then to the country-market group and their existing behavioural profile. The matrix reports counts and commercial context for those combinations. This is cross-classification, not a third clustering fit, and provides no verified company-size, industry or ownership information.','',
           f"All {len(audit['unchangedTables'])} unrelated database tables and saved behavioural scaler/PCA/K-means parameters were checked unchanged. Customer preprocessing, behavioural K choices, MDFCM updates, memberships, tracking and metrics were preserved. There are {audit['latestCustomers']:,} unique customers and {audit['latestMarketBehaviourCombinations']} occupied combinations at Cycle 9.",'',
           '## Updated country-market metrics','', '| Cycle | Markets | Occupied groups | Silhouette | DB | CH |','|---|---:|---:|---:|---:|---:|']
    for r in summary.itertuples():
        lines.append(f'| {r.CycleID} | {r.Markets} | {r.OccupiedGroups} | {r.SilhouetteScore:.4f} | {r.DaviesBouldinScore:.4f} | {r.CalinskiHarabaszScore:.2f} |')
    (target/'COUNTRY_MARKET_UPDATE.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--source-run',type=Path,required=True)
    p.add_argument('--output-run',type=Path,required=True)
    p.add_argument('--desktop-output',type=Path)
    a=p.parse_args()
    update(a.source_run,a.output_run,a.desktop_output)
