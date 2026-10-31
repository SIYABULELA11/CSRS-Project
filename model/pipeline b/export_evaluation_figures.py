"""Export evaluation evidence and reference-style plots from an existing fitted run.

Reads the database and fitted parameters without fitting or changing assignments.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

GREEN = '#075F49'
STYLE = {'font.family':'DejaVu Serif','font.size':10,'axes.titlesize':14,'axes.titleweight':'bold',
         'axes.edgecolor':'#333333','axes.linewidth':.9,'grid.color':'#DADADA','grid.linewidth':.7,
         'axes.facecolor':'white','figure.facecolor':'white','xtick.labelsize':9,'ytick.labelsize':9}
PANELS = [
    ('SilhouetteScore','Silhouette score','Higher indicates better separation'),
    ('DaviesBouldinScore','Davies–Bouldin index','Lower is better'),
    ('CalinskiHarabaszScore','Calinski–Harabasz score','Higher is better'),
    ('AverageMembership','Mean maximum membership','Higher indicates stronger concentration'),
    ('XieBeniIndex','Xie–Beni index','Lower is better'),
    ('MigrationRate','Migration rate','Returning customers; percent; descriptive'),
]


def serializable(frame):
    return json.loads(frame.to_json(orient='records'))


def panel(axis, x, y, title, subtitle, xlabel='Cycle', selected=None):
    axis.plot(x,y,color=GREEN,marker='o',markersize=4.8,linewidth=1.9)
    axis.set_title(title,pad=22)
    axis.text(.5,1.025,subtitle,transform=axis.transAxes,ha='center',va='bottom',fontsize=9,color='#5B5B5B')
    axis.set_xlabel(xlabel,labelpad=7);axis.set_xticks(x)
    axis.grid(True,alpha=.8);axis.set_axisbelow(True)
    axis.ticklabel_format(axis='y',style='plain',useOffset=False)
    if len(x)==1:
        axis.set_xlim(x[0]-.5,x[0]+.5)
        axis.annotate(f'{y[0]:,.4g}',(x[0],y[0]),xytext=(9,9),textcoords='offset points',fontsize=10,color=GREEN)
    else:axis.margins(x=.04,y=.12)
    if selected is not None:
        axis.axvline(selected,color='#777777',linestyle='--',linewidth=1)
        axis.text(selected,.95,f' K={selected}',transform=axis.get_xaxis_transform(),ha='left',va='top',fontsize=9,color='#555555')


def save_figure(figure, output, caption):
    figure.text(.5,.012,caption,ha='center',va='bottom',fontsize=9,color='#555555')
    figure.tight_layout(rect=(.01,.065,.995,.985),w_pad=2.3,h_pad=3.4)
    for extension in ['png','svg']:
        figure.savefig(output.with_suffix('.'+extension),dpi=220,bbox_inches='tight',facecolor='white')
    plt.close(figure)


def export(run):
    run=run.resolve();database=run/'csrs_pipeline_b_repaired.db'
    before=hashlib.sha256(database.read_bytes()).hexdigest()
    with sqlite3.connect(database.as_uri()+'?mode=ro',uri=True) as db:
        quality=pd.read_sql_query('SELECT * FROM Current_Model_Quality ORDER BY cycleNumber',db)
        migration=pd.read_sql_query('SELECT CycleID,MigrationRate,Converged,Iterations FROM Dynamic_Cycle_Summary',db)
        selection=pd.read_sql_query('SELECT * FROM Cycle_0_Elbow_Results ORDER BY K',db)
        geographic=pd.read_sql_query('SELECT * FROM Geographic_Cycle_Summary',db)
        features=pd.read_sql_query('SELECT * FROM Geographic_Market_Features',db)
    behavioural=quality.merge(migration,on='CycleID',how='left',suffixes=('','_stored'))
    baseline=behavioural.loc[behavioural.cycleNumber.eq(0)].iloc[0]
    dynamic=behavioural.loc[behavioural.cycleNumber.gt(0)]
    geographic['cycleNumber']=geographic.CycleID.str.replace('Cycle_','',regex=False).astype(int)
    geographic=geographic.sort_values('cycleNumber').reset_index(drop=True)
    metadata=json.loads((run/'model_metadata.json').read_text(encoding='utf-8'))
    model=joblib.load(run/'cycle0_geographic_kmeans.pkl');scaler=joblib.load(run/'cycle0_geographic_scaler.pkl')
    feature_names=list(scaler.feature_names_in_)
    conversion={int(k):int(v) for k,v in metadata['geographic_cluster_mapping'].items()}
    centres=np.empty_like(model.cluster_centers_)
    for raw,canonical in conversion.items():centres[canonical]=model.cluster_centers_[raw]
    residuals=[]
    for index,row in geographic.iterrows():
        data=features.loc[features.CycleID.eq(row.CycleID)]
        coordinates=data[['Scaled_'+column for column in feature_names]].to_numpy(float)
        labels=data.Geographic_Cluster_Number.to_numpy(int)
        squared=((coordinates[:,None,:]-centres[None,:,:])**2).sum(axis=2)
        assert np.array_equal(squared.argmin(axis=1),labels),row.CycleID
        inertia=float(squared[np.arange(len(data)),labels].sum())
        geographic.loc[index,'Inertia']=inertia
        geographic.loc[index,'FittedK']=len(centres)
        geographic.loc[index,'OccupiedK']=len(np.unique(labels))
        assert len(data)==int(row.Markets)
        for field,value in [('SilhouetteScore',silhouette_score(coordinates,labels)),('DaviesBouldinScore',davies_bouldin_score(coordinates,labels)),('CalinskiHarabaszScore',calinski_harabasz_score(coordinates,labels))]:
            residual=abs(float(row[field])-float(value));residuals.append(residual)
            assert residual<1e-9*max(1,abs(value)),(row.CycleID,field,residual)
    assert np.isclose(geographic.loc[0,'Inertia'],model.inertia_,rtol=1e-10,atol=1e-8)
    output=run/'Research_Figures'/'Validation';output.mkdir(exist_ok=True,parents=True)
    with plt.rc_context(STYLE):
        for frame,filename in [(behavioural,'evaluation_metrics_cycles_0_9'),(dynamic,'evaluation_metrics_cycles_1_9')]:
            figure,axes=plt.subplots(2,3,figsize=(16.5,8.3))
            for axis,(field,title,subtitle) in zip(axes.flat,PANELS):
                observed=frame.loc[frame[field].notna()]
                panel(axis,observed.cycleNumber.to_numpy(int),observed[field].to_numpy(float),title,subtitle)
            save_figure(figure,output/filename,'Observed values from the current fit. Fuzzy metrics and migration apply only to Cycles 1–9; maximum membership is not a correctness probability.')
        figure,axes=plt.subplots(2,3,figsize=(16.5,8.3))
        chosen=int(baseline.SelectedK)
        panel(axes[0,0],selection.K.to_numpy(int),selection.Inertia.to_numpy(float),'Cycle 0 WCSS elbow','Primary K-selection evidence',xlabel='Number of clusters (K)',selected=chosen)
        panel(axes[0,1],selection.K.to_numpy(int),selection.Silhouette_Score.to_numpy(float),'Silhouette by candidate K','Supporting K-selection evidence',xlabel='Number of clusters (K)',selected=chosen)
        for axis,(field,title,direction) in zip([axes[0,2],*axes[1,:]],
                [('SilhouetteScore','Baseline silhouette','Higher indicates better separation'),
                 ('DaviesBouldinScore','Baseline Davies–Bouldin','Lower is better'),
                 ('CalinskiHarabaszScore','Baseline Calinski–Harabasz','Higher is better'),
                 ('Inertia','Baseline inertia (WCSS)','At accepted K=5; same data and scale')]):
            panel(axis,np.array([0]),np.array([float(baseline[field])]),title,direction)
        save_figure(figure,output/'evaluation_cycle0_kmeans','Cycle 0 is one static K-means baseline, K=5. Single points are not time trends; fuzzy validity and fuzzy membership are not applicable.')
        figure,axes=plt.subplots(2,3,figsize=(16.5,8.3))
        for axis,(field,title,subtitle) in zip(axes.flat,
                [('SilhouetteScore','Market silhouette','Higher indicates better separation'),
                 ('DaviesBouldinScore','Market Davies–Bouldin','Lower is better'),
                 ('CalinskiHarabaszScore','Market Calinski–Harabasz','Higher is better'),
                 ('Inertia','Distance to fixed market centres','Squared-error total; scale and count sensitive'),
                 ('Markets','Country markets evaluated','Population context; not a quality score'),
                 ('OccupiedK','Occupied country-market groups',f'Model context; fixed baseline K={len(centres)}')]):
            panel(axis,geographic.cycleNumber.to_numpy(int),geographic[field].to_numpy(float),title,subtitle)
        save_figure(figure,output/'evaluation_geographic_market','Country-market K-means: fit at Cycle 0 and use frozen scaling/centres later. No fuzzy metrics apply; market counts and K are context, not validity scores.')
    figures={'combined':'Validation/evaluation_metrics_cycles_0_9.png','baseline':'Validation/evaluation_cycle0_kmeans.png','dynamic':'Validation/evaluation_metrics_cycles_1_9.png','geographic':'Validation/evaluation_geographic_market.png'}
    report={'available':True,'sourceRun':run.name,'sourceDatabaseSha256':before,
            'baseline':json.loads(baseline.to_json()),'kSelection':serializable(selection),
            'behaviouralCycles':serializable(behavioural),'dynamicCycles':serializable(dynamic),
            'geographic':{'fitCycle':'Cycle_0','fittedK':len(centres),'unit':'country markets','featureSpace':f'{len(feature_names)} baseline-scaled market features',
                          'method':'K-means fitted on Cycle 0; later market snapshots use the same RobustScaler and fixed centres. Customer–market combinations are derived labels, not another fitted clustering model.',
                          'cycles':serializable(geographic)},'figures':figures,
            'validation':{'noRefitting':True,'allMarketAssignmentsMatchSavedCentres':True,'maximumGeographicMetricResidual':max(residuals),'baselineGeographicInertiaMatchesSavedModel':True}}
    assert hashlib.sha256(database.read_bytes()).hexdigest()==before,'Evaluation export modified the model database'
    (run/'evaluation_report.json').write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8')
    behavioural.to_csv(output/'evaluation_behavioural_metrics.csv',index=False)
    geographic.to_csv(output/'evaluation_geographic_metrics.csv',index=False)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--run-dir',type=Path,required=True)
    report=export(parser.parse_args().run_dir)
    print(json.dumps({'run':report['sourceRun'],'figures':report['figures'],'validation':report['validation']},indent=2))
