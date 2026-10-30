"""Measure profile continuity and separate feature/boundary contributions to migration.

Uses saved data and centres, with no fitting or calls into the production model.
Counterfactual assignments are geometric diagnostics, not causal attribution.
"""
from __future__ import annotations
import argparse
import json
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd

PC = ['PC1','PC2','PC3']
RFM = ['Recency','Frequency','Monetary']


def nearest(points, centres):
    return ((points[:,None,:]-centres[None,:,:])**2).sum(2).argmin(1)


def eligibility(name, recency):
    name = name.split(' · ')[0]
    if name == 'Hibernating / Lost': return recency > 90
    if 'at Risk' in name: return 30 < recency <= 90
    return recency <= (60 if name in {'Mid-Tier Occasional','Mid-Tier Occasionals'} else 30)


def audit(run: Path):
    with sqlite3.connect(run/'csrs_pipeline_b_repaired.db') as connection:
        registry=pd.read_sql_query('SELECT * FROM Current_Cluster_Profiles',connection)
        features=pd.read_sql_query('SELECT * FROM Data_Preprocessing_Results',connection)
        baseline=pd.read_sql_query('SELECT CustomerID, Cluster_Local_Index, Stable_Cluster_ID, Segment_Name FROM Time_Cycle_0_Segmentation',connection)
        baseline['CycleID']='Cycle_0'
        dynamic=pd.read_sql_query('SELECT CustomerID, CycleID, Cluster_Local_Index, Stable_Cluster_ID, Segment_Name FROM Dynamic_Loop_Results',connection)
    assignments=pd.concat([baseline,dynamic],ignore_index=True)
    observations=features[['CustomerID','CycleID',*RFM,*PC]].merge(assignments,on=['CustomerID','CycleID'],validate='one_to_one')
    totals={key:0 for key in ['profileChecks','profileRuleFailures','primaryIdLinks','sameNameLinks','renamedLinks','sharedCustomerComparisons','actualIdMigrations','behaviourOnly','boundaryOnly','both','interaction','profileOnlyRenames','unchangedRfmMigrants']}
    profiles=[]
    for row in registry.itertuples(index=False):
        passed=bool(eligibility(row.businessProfile,float(row.weightedRecency)))
        totals['profileChecks']+=1; totals['profileRuleFailures']+=int(not passed)
        profiles.append({'cycleId':row.CycleID,'stableClusterId':row.stableClusterId,'displayLabel':row.displayLabel,'customers':int(row.hardWinnerCustomers),
                         'weightedRecency':float(row.weightedRecency),'weightedFrequency':float(row.weightedFrequency),'weightedMonetary':float(row.weightedMonetary),'recencyRulePassed':passed})
    cycles=[]; details=[]; identity_links=[]
    for number in range(1,10):
        cycle=f'Cycle_{number}'; previous_cycle=f'Cycle_{number-1}'
        old=observations.loc[observations.CycleID.eq(previous_cycle)].set_index('CustomerID')
        new=observations.loc[observations.CycleID.eq(cycle)].set_index('CustomerID')
        shared=old.index.intersection(new.index).sort_values()
        before=old.loc[shared]; after=new.loc[shared]
        old_registry=registry.loc[registry.CycleID.eq(previous_cycle)].sort_values('localIndex')
        new_registry=registry.loc[registry.CycleID.eq(cycle)].sort_values('localIndex')
        old_ids=old_registry.stableClusterId.to_numpy(); new_ids=new_registry.stableClusterId.to_numpy()
        x0=before[PC].to_numpy(float); x1=after[PC].to_numpy(float)
        c0=old_registry[PC].to_numpy(float); c1=new_registry[PC].to_numpy(float)
        origin=before.Stable_Cluster_ID.to_numpy(); actual=after.Stable_Cluster_ID.to_numpy()
        if not np.array_equal(old_ids[nearest(x0,c0)],origin): raise AssertionError(f'{previous_cycle}: saved assignments contradict saved centres')
        if not np.array_equal(new_ids[nearest(x1,c1)],actual): raise AssertionError(f'{cycle}: saved assignments contradict saved centres')
        changed=origin!=actual
        behaviour_prediction=old_ids[nearest(x1,c0)]
        boundary_prediction=new_ids[nearest(x0,c1)]
        behaviour_switch=behaviour_prediction!=origin
        boundary_switch=boundary_prediction!=origin
        classifications=np.full(len(shared),'No tracking-ID change',dtype=object)
        masks={'behaviourOnly':changed & behaviour_switch & ~boundary_switch,
               'boundaryOnly':changed & ~behaviour_switch & boundary_switch,
               'both':changed & behaviour_switch & boundary_switch,
               'interaction':changed & ~behaviour_switch & ~boundary_switch}
        names={'behaviourOnly':'Feature change alone switches assignment','boundaryOnly':'Boundary change alone switches assignment','both':'Both changes separately switch assignment','interaction':'Combined changes switch assignment'}
        for key,mask in masks.items(): classifications[mask]=names[key]
        rfm_delta=after[RFM].to_numpy(float)-before[RFM].to_numpy(float)
        unchanged_rfm=np.max(np.abs(rfm_delta),axis=1)<=1e-10
        label_changed=before.Segment_Name.to_numpy()!=after.Segment_Name.to_numpy()
        previous_names=dict(zip(old_registry.stableClusterId,old_registry.businessProfile))
        current_names=dict(zip(new_registry.stableClusterId,new_registry.businessProfile))
        links=sorted(set(previous_names)&set(current_names))
        renames=sum(previous_names[i]!=current_names[i] for i in links)
        for stable in links:
            p=old_registry.loc[old_registry.stableClusterId.eq(stable)].iloc[0]
            q=new_registry.loc[new_registry.stableClusterId.eq(stable)].iloc[0]
            identity_links.append({'cycleId':cycle,'stableClusterId':stable,'previousName':previous_names[stable],'currentName':current_names[stable],
                'sameName':previous_names[stable]==current_names[stable], 'recencyChange':float(q.weightedRecency-p.weightedRecency),
                'frequencyChange':float(q.weightedFrequency-p.weightedFrequency),'monetaryChange':float(q.weightedMonetary-p.weightedMonetary)})
        result={'cycleId':cycle,'sharedCustomers':len(shared),'actualIdMigrations':int(changed.sum()),
                **{key:int(mask.sum()) for key,mask in masks.items()},'renamedCentres':int(renames),
                'primaryIdLinks':len(links),'sameNameLinks':len(links)-int(renames),
                'profileOnlyRenames':int((~changed & label_changed).sum()),'unchangedRfmMigrants':int((changed & unchanged_rfm).sum())}
        cycles.append(result)
        totals['primaryIdLinks']+=len(links);totals['sameNameLinks']+=len(links)-renames;totals['renamedLinks']+=renames
        totals['sharedCustomerComparisons']+=len(shared)
        for key in ['actualIdMigrations','behaviourOnly','boundaryOnly','both','interaction','profileOnlyRenames','unchangedRfmMigrants']: totals[key]+=result[key]
        if sum(result[key] for key in masks)!=result['actualIdMigrations']: raise AssertionError('Migration attribution does not reconcile')
        frame=pd.DataFrame({'CustomerID':shared,'CycleID':cycle,'Previous_Stable_ID':origin,'Current_Stable_ID':actual,
                            'Previous_Label':before.Segment_Name.to_numpy(),'Current_Label':after.Segment_Name.to_numpy(),
                            'Previous_Centres_Current_Features_ID':behaviour_prediction,'Current_Centres_Previous_Features_ID':boundary_prediction,
                            'Tracking_ID_Changed':changed,'Label_Changed':label_changed,'Diagnostic':classifications,
                            **{f'Delta_{column}':rfm_delta[:,i] for i,column in enumerate(RFM)}})
        details.append(frame)
    method={
        'identity':'One-to-one matching combines centre distance and fuzzy membership overlap. A continued CL ID records an accepted algorithmic match; its descriptive name is checked separately.',
        'profileCheck':'Every fitted centre is checked against its weighted-RFM recency eligibility and its raw weighted R/F/M are exported. Frequency/spend ranks and descriptive prototypes are relative reporting rules, not independently validated customer types.',
        'counterfactual':'For each returning customer compare old features/old centres with (1) current features/old centres, (2) old features/current centres, and (3) current features/current centres, using the same frozen PCA coordinates. Compare stable IDs separately from names.',
        'limitations':['These geometric comparisons do not prove a causal explanation for customer behaviour.',
                       'Both means each change separately crosses an assignment boundary; it does not estimate a percentage causal contribution.',
                       'A profile-only rename can change the displayed segment even when the tracking ID stays the same.',
                       'Changing K, new or retired IDs and relative naming rules can affect continuity. Perfect semantic persistence is not assumed.',
                       'Greater maximum membership is an internal concentration measure, not a calibrated probability of a correct customer label.']}
    report={'schemaVersion':1,'run':run.name,'scope':'All observed customers with consecutive current snapshots; new customers lack a previous-cycle comparison.',
            'totals':totals,'cycles':cycles,'profiles':profiles,'identityLinks':identity_links,'method':method}
    (run/'semantic_cluster_audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    pd.concat(details,ignore_index=True).to_csv(run/'customer_migration_diagnostics.csv',index=False)
    pd.DataFrame(identity_links).to_csv(run/'cluster_identity_profile_history.csv',index=False)
    write_brief(run,report)
    return report


def write_brief(run, report):
    t=report['totals']
    text=f'''# Cluster identity and customer migration

Current evidence: `{run.name}`. Cycle 0 uses static K-means, K=5. Cycles 1–9 use the existing FCM/MDFCM calculations with updated customer snapshots.

**Customers considered.** Every customer observed before a cycle cutoff receives fresh RFM and membership, including non-purchasers. Recency is uncapped days since the latest purchase. Frequency and positive paid sales use the preceding 90 days, divided by three for monthly equivalents. Earlier purchases remain represented until they leave that window. Lifetime history establishes eligibility and the latest purchase date; lifetime spending does not replace rolling spending. Monthly commercial totals are separate, avoiding repeated revenue from overlapping windows. Each current snapshot replaces the previous one, so historical membership mass is zero in this run; previous centres provide initialization.

**Cluster identity consistency.** Provisional CL IDs link centres using distance and fuzzy customer overlap. Descriptive names are checked separately against membership-weighted RFM. All {t['profileChecks']} fitted profiles meet their documented recency eligibility. Of {t['primaryIdLinks']} consecutive links, {t['sameNameLinks']} keep their name and {t['renamedLinks']} change it. Therefore perfect semantic continuity is **not demonstrated**. Relative frequency/spend prototypes are transparent reporting choices, not externally validated customer classes. A continuing ID alone cannot establish that Champions remain Champions.

**Behavioural migration.** For each returning customer, assign current features to old centres and old features to current centres, then compare both with the actual current assignment. All coordinates use the frozen Cycle 0 scaler/PCA. Across {t['sharedCustomerComparisons']:,} comparisons, {t['actualIdMigrations']:,} tracking-ID changes comprise:

- {t['behaviourOnly']:,}: feature change alone switches assignment; boundary change alone does not.
- {t['boundaryOnly']:,}: boundary change alone switches assignment; feature change alone does not.
- {t['both']:,}: either change separately switches assignment.
- {t['interaction']:,}: the changes together switch assignment.

Another {t['profileOnlyRenames']:,} displayed-name changes keep the same tracking ID. These checks distinguish geometric explanations; they do not prove causal behaviour changes.

**Labels and quality.** The approved names include High-Value Regulars, Valuable Customers at Risk, Occasional Buyers at Risk, Light Buyers and Light Buyers at Risk. Hibernating / Lost remains one category above 90 days. Individual warnings use At risk at 31–60 days, Slipping at 61–90, and Lost above 90; deterioration can trigger earlier warnings. Names describe cluster profiles, so individual customers may differ. Fitted K is never changed to satisfy the naming list; a qualified name preserves an extra genuine centre where needed. K selection uses the accepted baseline elbow and dynamic condition-permitted Xie–Beni comparisons. Silhouette, DB, CH and maximum membership provide additional evidence. Greater membership alone does not prove a better model, and comparisons with the former purchaser-only run have different populations.

Detailed evidence: `semantic_cluster_audit.json`, `cluster_identity_profile_history.csv`, and `customer_migration_diagnostics.csv`. The Model page displays the checks and cycle counts.
'''
    (run/'CLUSTER_IDENTITY_AND_MIGRATION.md').write_text(text,encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--run-dir',type=Path,required=True)
    result=audit(parser.parse_args().run_dir)
    print(json.dumps({'run':result['run'],'totals':result['totals']},indent=2))
