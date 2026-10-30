"""Independent audit of MDFCM retained-centre Eqs.14-16 and provisional cluster-ID matching.
No production processing functions are imported or called.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sqlite3

import joblib
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment


def membership(x: np.ndarray, centres: np.ndarray, m: float=2.) -> np.ndarray:
    squared=((x[:,None,:]-centres[None,:,:])**2).sum(axis=2)
    zero=squared <= 1e-24
    # Direct inverse squared-distance weights for m=2, followed by row normalization.
    power=np.maximum(squared,1e-24)**(-1./(m-1.))
    result=power/power.sum(axis=1,keepdims=True)
    for row in np.flatnonzero(zero.any(axis=1)):
        result[row]=zero[row]/zero[row].sum()
    return result


def objective(x,centres,u,m=2.):
    return float(((u**m)*((x[:,None,:]-centres[None,:,:])**2).sum(axis=2)).sum())


def retained_centres(x,old_centres,old_mass,m=2.,alpha=.05,tolerance=.01):
    u=membership(x,old_centres,m)
    uncertain=np.all(np.abs(u-1./len(old_centres)) <= alpha,axis=1)
    # Build distinct-centre bounds directly, without relying on a diagonal sentinel.
    bound=np.array([max(np.linalg.norm(centre-other) for j,other in enumerate(old_centres) if j!=i)/2
                    for i,centre in enumerate(old_centres)])
    distant=np.all(np.linalg.norm(x[:,None,:]-old_centres[None,:,:],axis=2)>bound[None,:],axis=1)
    eligible=~(uncertain & distant)
    previous_objective=None
    for iteration in range(1,301):
        labels=u.argmax(axis=1)
        centres=old_centres.copy()
        incoming_mass=[]
        blend=[]
        for cluster in range(len(old_centres)):
            weight=u[eligible,cluster]**m
            if not len(weight) or weight.sum()<=1e-12:
                incoming_mass.append(0.)
                blend.append(0.)
                continue
            incoming_centre=np.average(x[eligible],axis=0,weights=weight)
            mass=float(u[eligible & (labels==cluster),cluster].sum())
            coefficient=mass/(old_mass[cluster]+mass) if old_mass[cluster]+mass>1e-12 else 0.
            centres[cluster]=(1.-coefficient)*old_centres[cluster]+coefficient*incoming_centre
            incoming_mass.append(mass)
            blend.append(coefficient)
        u=membership(x,centres,m)
        current=objective(x,centres,u,m)
        change=abs(current-previous_objective) if previous_objective is not None else float('inf')
        if previous_objective is not None and change<=tolerance:
            break
        previous_objective=current
    else:
        raise AssertionError('Independent retained-centre update did not converge')
    return {'centres':centres,'memberships':u,'objective':current,'iterations':iteration,'final_objective_change':change,
            'condition1_count':int(uncertain.sum()),'condition2_count':int(distant.sum()),'unclassifiable_count':int((~eligible).sum()),
            'last_iteration_incoming_primary_membership_mass':incoming_mass,'last_iteration_blend_weight':blend}


def standard_fcm(x, initial, tolerance=.01):
    """Independently iterate the standard weighted-centre FCM equations from a specified start."""
    u=membership(x,initial)
    previous=None
    for iteration in range(1,301):
        weights=u*u
        centres=(weights.T@x)/np.maximum(weights.sum(axis=0)[:,None],1e-12)
        new_u=membership(x,centres)
        current=objective(x,centres,new_u)
        change=abs(current-previous) if previous is not None else float('inf')
        u=new_u
        if previous is not None and change<=tolerance:
            converged=True
            break
        previous=current
    else:
        converged=False
    squared_separations=[float(np.sum((centres[i]-centres[j])**2))
                         for i in range(len(centres)) for j in range(i+1,len(centres))]
    separation=min(squared_separations)
    xb=current/(len(x)*separation) if separation>1e-12 else float('nan')
    return {'centres':centres,'objective':current,'xie_beni':xb,'iterations':iteration,
            'objective_change':change,'converged':converged}


def replay_all_split_starts(x, previous_centres):
    squared=((x[:,None,:]-previous_centres[None,:,:])**2).sum(axis=2)
    assignment=squared.argmin(axis=1)
    starts=[]
    for source in range(len(previous_centres)):
        points=x[assignment==source]
        if len(points)>1:
            centred=points-points.mean(axis=0)
            # Independent sample covariance construction; no production initializer is called.
            covariance=(centred.T@centred)/(len(points)-1)
            _,vectors=np.linalg.eigh(covariance)
            direction=vectors[:,-1]
            spread=np.sqrt(max(float(squared[assignment==source,source].sum())/len(points),1e-8))
        else:
            direction=np.zeros(x.shape[1])
            direction[0]=1.
            spread=.001
        offset=max(float(spread)/2.,.001)*direction
        initial=previous_centres.copy()
        initial[source]=previous_centres[source]-offset
        initial=np.vstack([initial,previous_centres[source]+offset])
        fit=standard_fcm(x,initial)
        fit['split_source']=source
        starts.append(fit)
    return starts


def prior_mass(previous: pd.DataFrame, id_by_local: dict[int,str]) -> tuple[np.ndarray,dict]:
    local_by_id={stable:local for local,stable in id_by_local.items()}
    mass=np.zeros(len(id_by_local))
    inactive_mass=np.zeros(len(id_by_local))
    excluded=0
    zero_mass=0
    for row in previous.itertuples(index=False):
        if row.Stable_Cluster_ID not in local_by_id:
            excluded+=1
            continue
        detail=json.loads(row.Fuzzy_Membership_Details)
        value=next(float(item['membership']) for item in detail if item['stable_cluster_id']==row.Stable_Cluster_ID)
        assert np.isfinite(value) and value>=0
        local=local_by_id[row.Stable_Cluster_ID]
        mass[local]+=value
        if row.Activity_Status=='Inactive':
            inactive_mass[local]+=value
        zero_mass+=int(value==0)
    return mass,{'mass_by_fitted_local_cluster':mass.tolist(),'inactive_customer_mass_included':inactive_mass.tolist(),
                 'customers_excluded_because_primary_ID_already_retired':excluded,'included_zero_primary_memberships':zero_mass,
                 'definition':'Sum each prior customer\'s membership in their primary stable ID if that ID still maps to a fitted prior centre. Retained inactive customers can contribute. This primary-assignment mass differs from summing every secondary fuzzy component.'}


def reconstruct_lineage(previous,current,previous_centres,current_centres,id_by_local,next_id,x):
    previous_by_id={stable:local for local,stable in id_by_local.items()}
    old=previous.set_index('CustomerID')
    shared=[row for row in current.itertuples(index=False) if row.CustomerID in old.index]
    a=np.zeros((len(shared),len(previous_centres)))
    b=np.zeros((len(shared),len(current_centres)))
    current_vectors=dict(zip(current.CustomerID,membership(x,current_centres)))
    for i,row in enumerate(shared):
        old_details=json.loads(old.loc[row.CustomerID].Fuzzy_Membership_Details)
        for component in old_details:
            stable=component['stable_cluster_id']
            if stable in previous_by_id:
                a[i,previous_by_id[stable]]=float(component['membership'])
        # Tracking used full precision current memberships before DB rounding to eight decimals.
        b[i]=current_vectors[row.CustomerID]
    overlap=np.zeros((a.shape[1],b.shape[1]))
    for i in range(a.shape[1]):
        for j in range(b.shape[1]):
            union=np.maximum(a[:,i],b[:,j]).sum()
            overlap[i,j]=np.minimum(a[:,i],b[:,j]).sum()/union if union>0 else 0.
    distance=np.linalg.norm(previous_centres[:,None,:]-current_centres[None,:,:],axis=2)
    nonzero=distance[distance>1e-12]
    scale=float(np.median(nonzero)) if len(nonzero) else 1.
    cost=.5*distance/max(scale,1e-12)+.5*(1.-overlap)
    p,q=cost.shape
    assignment=np.zeros((p+q,p+q))
    assignment[:p,:q]=np.where(overlap>=.05,cost,1e9)
    assignment[:p,q:]=.5
    assignment[p:,:q]=.5
    rows,columns=linear_sum_assignment(assignment)
    pairs={(int(i),int(j)) for i,j in zip(rows,columns) if i<p and j<q and assignment[i,j]<1.}
    current_ids={j:id_by_local[i] for i,j in pairs}
    for j in range(q):
        if j not in current_ids:
            current_ids[j]=f'CL-{next_id:03d}'
            next_id+=1
    return current_ids,next_id,pairs,distance,overlap,cost


def audit(run: Path):
    db=run/'csrs_pipeline_b_repaired.db'
    with sqlite3.connect(db) as c:
        baseline=pd.read_sql_query("SELECT * FROM Time_Cycle_0_Segmentation ORDER BY CustomerID",c)
        preprocessing=pd.read_sql_query('SELECT * FROM Data_Preprocessing_Results',c)
        dynamic=pd.read_sql_query('SELECT * FROM Dynamic_Loop_Results ORDER BY DynamicID',c)
        history=pd.read_sql_query('SELECT * FROM Cluster_Lineage',c)
        centres=pd.read_sql_query('SELECT * FROM Dynamic_Centroids ORDER BY ClusterID',c)
        summary=pd.read_sql_query('SELECT * FROM Dynamic_Cycle_Summary ORDER BY CycleID',c)
        candidates=pd.read_sql_query('SELECT * FROM MDFCM_Candidate_Evaluations',c)
    baseline['Activity_Status']=np.where(baseline.Frequency>0,'Active','Inactive')
    previous=baseline
    ids={int(local):str(group.Stable_Cluster_ID.iloc[0]) for local,group in baseline.groupby('Cluster_Local_Index')}
    saved=joblib.load(run/'cycle0_kmeans_model.pkl')
    metadata=json.loads((run/'model_metadata.json').read_text(encoding='utf-8'))
    mapping={int(k):int(v) for k,v in metadata['behavioural_cluster_mapping'].items()}
    previous_centres=np.empty_like(saved.cluster_centers_)
    for raw,canonical in mapping.items():
        previous_centres[canonical]=saved.cluster_centers_[raw]
    next_id=len(previous_centres)+1
    outputs=[]
    max_selected_centre_error=0.
    max_retained_objective_error=0.
    split_starts_checked=0
    selected_splits_checked=0
    max_split_score_error=0.
    max_selected_split_centre_error=0.
    max_lineage_error={'centroid_distance':0.,'weighted_jaccard':0.,'match_cost':0.}
    total_retained=0
    total_lineage_rows=0
    for number in range(1,10):
        cycle=f'Cycle_{number}'
        current=dynamic.loc[dynamic.CycleID.eq(cycle)].copy()
        active=current.loc[current.Is_Model_Fit.eq(1)].copy()
        assert len(active)==len(current)
        pca=preprocessing.loc[preprocessing.CycleID.eq(cycle)].set_index('CustomerID')
        x=pca.loc[active.CustomerID,['PC1','PC2','PC3']].to_numpy(float)
        actual_centres=centres.loc[centres.CycleID.eq(cycle)].sort_values('ClusterID')[['PC1','PC2','PC3']].to_numpy(float)
        cycle_summary=summary.loc[summary.CycleID.eq(cycle)].iloc[0]
        absent_prior=previous.loc[~previous.CustomerID.isin(active.CustomerID)]
        mass,mass_report=prior_mass(absent_prior,ids)
        assert not len(absent_prior) and np.all(mass==0), 'Fullreplacement observations must notcount prior snapshots twice'
        mass_report['replacement_snapshot_policy']='Prior mass applies only to IDs absent from incoming snapshot; all previous IDs are replaced here' 
        retained=retained_centres(x,previous_centres,mass)
        retained_candidate=candidates.loc[candidates.CycleID.eq(cycle)&candidates.CandidateK.eq(len(previous_centres))]
        record={'cycle':number,'prior_k':len(previous_centres),'selected_k':len(actual_centres),'historical_mass':mass_report,'incremental_candidate_present':not retained_candidate.empty}
        if not retained_candidate.empty:
            candidate=retained_candidate.iloc[0]
            error=abs(retained['objective']-float(candidate.FuzzyObjective))
            assert error<1e-9,(cycle,'retained objective',error)
            assert retained['iterations']==int(candidate.Iterations),(cycle,'retained iterations')
            assert abs(retained['final_objective_change']-float(candidate.FinalObjectiveChange))<1e-9
            max_retained_objective_error=max(max_retained_objective_error,error)
            record['retained_objective_residual']=error
            record['retained_iterations']=retained['iterations']
            record['last_iteration_blend_weights']=retained['last_iteration_blend_weight']
        if cycle_summary.SelectedOperation=='incremental_center_movement':
            error=float(np.max(np.abs(retained['centres']-actual_centres)))
            assert error<1e-10,(cycle,'retained centres',error)
            max_selected_centre_error=max(max_selected_centre_error,error)
            record['selected_retained_centre_residual']=error
            total_retained+=1
        split_candidate=candidates.loc[candidates.CycleID.eq(cycle)&candidates.CandidateK.eq(len(previous_centres)+1)]
        if not split_candidate.empty:
            replayed=replay_all_split_starts(x,previous_centres)
            split_starts_checked+=len(replayed)
            usable=[fit for fit in replayed if fit['converged'] and np.isfinite(fit['xie_beni']) and np.isfinite(fit['objective'])]
            assert usable,(cycle,'no independently converged split fit')
            best=min(usable,key=lambda fit:fit['xie_beni'])
            candidate=split_candidate.iloc[0]
            chosen_source=json.loads(candidate.SourceLocalClusters)
            assert len(chosen_source)==1
            chosen=next(fit for fit in usable if fit['split_source']==int(chosen_source[0]))
            # Near-equal starts can exchange order at floating precision; verify score equivalence.
            best_gap=chosen['xie_beni']-best['xie_beni']
            assert abs(best_gap)<1e-9,(cycle,'selected split start is not minimum XB',best_gap)
            score_error=abs(chosen['xie_beni']-float(candidate.XieBeniIndex))
            objective_error=abs(chosen['objective']-float(candidate.FuzzyObjective))
            assert score_error<1e-9,(cycle,'split XB replay',score_error)
            assert objective_error<1e-8,(cycle,'split objective replay',objective_error)
            assert chosen['iterations']==int(candidate.Iterations),(cycle,'split iteration replay')
            max_split_score_error=max(max_split_score_error,score_error)
            record['split_candidate_replay']={
                'starts_checked':len(replayed),'converged_finite_starts':len(usable),
                'recorded_source':int(chosen_source[0]),'best_source_independent':int(best['split_source']),
                'recorded_source_XB_gap_above_independent_best':best_gap,
                'recorded_XB_residual':score_error,'recorded_objective_residual':objective_error,
                'recorded_iterations':int(candidate.Iterations),'independent_iterations':chosen['iterations'],
                'start_scores':[{'source':int(fit['split_source']),'iterations':fit['iterations'],
                                 'converged':fit['converged'],'xie_beni':float(fit['xie_beni'])}
                                for fit in replayed],
            }
            if cycle_summary.SelectedOperation=='split_one_cluster':
                # Eigenvector sign can swap a split pair without changing the solution.
                distance=np.linalg.norm(chosen['centres'][:,None,:]-actual_centres[None,:,:],axis=2)
                left,right=linear_sum_assignment(distance)
                centre_error=float(np.max(np.abs(chosen['centres'][left]-actual_centres[right])))
                assert centre_error<1e-9,(cycle,'selected split centres',centre_error)
                record['split_candidate_replay']['selected_centre_residual_after_permutation']=centre_error
                max_selected_split_centre_error=max(max_selected_split_centre_error,centre_error)
                selected_splits_checked+=1
        actual_history=history.loc[history.CycleID.eq(cycle)]
        expected_ids,next_id,pairs,distances,jaccard,cost=reconstruct_lineage(previous,active,previous_centres,actual_centres,ids,next_id,x)
        actual_ids={}
        for local in range(len(actual_centres)):
            matching=actual_history.loc[actual_history.CurrentLocalCluster.eq(local)&(actual_history.IsPrimaryMatch.eq(1)|actual_history.LineageEvent.eq('created'))]
            assert len(matching)==1,(cycle,'fitted identity missing or duplicate',local)
            actual_ids[local]=str(matching.CurrentStableClusterID.iloc[0])
            assert actual_ids[local]==expected_ids[local],(cycle,'ID matching',local)
        actual_pairs={(int(row.PreviousLocalCluster),int(row.CurrentLocalCluster)) for row in actual_history.loc[actual_history.IsPrimaryMatch.eq(1)].itertuples(index=False)}
        assert pairs==actual_pairs,(cycle,'Hungarian primary continuation pairs')
        expected_retired=set(range(len(previous_centres)))-{i for i,j in pairs}
        actual_retired=set(actual_history.loc[actual_history.LineageEvent.eq('retired'),'PreviousLocalCluster'].astype(int))
        assert expected_retired==actual_retired,(cycle,'retirement IDs')
        expected_created=set(range(len(actual_centres)))-{j for i,j in pairs}
        actual_created=set(actual_history.loc[actual_history.LineageEvent.eq('created'),'CurrentLocalCluster'].astype(int))
        assert expected_created==actual_created,(cycle,'created IDs')
        expected_secondary={(i,j) for i in range(len(previous_centres)) for j in range(len(actual_centres)) if jaccard[i,j]>=.05 and (i,j) not in pairs}
        actual_secondary=set()
        for row in actual_history.itertuples(index=False):
            if pd.isna(row.PreviousLocalCluster) or pd.isna(row.CurrentLocalCluster):
                continue
            i,j=int(row.PreviousLocalCluster),int(row.CurrentLocalCluster)
            assert row.PreviousStableClusterID==ids[i] and row.CurrentStableClusterID==actual_ids[j]
            for key,expected,actual in [('centroid_distance',distances[i,j],row.CentroidDistance),('weighted_jaccard',jaccard[i,j],row.CustomerOverlapJaccard),('match_cost',cost[i,j],row.MatchCost)]:
                residual=abs(float(actual)-float(expected))
                assert residual<1e-10,(cycle,key,residual)
                max_lineage_error[key]=max(max_lineage_error[key],residual)
            if not int(row.IsPrimaryMatch):
                actual_secondary.add((i,j))
                split=(jaccard>=.05).sum(axis=1)[i]>1
                merge=(jaccard>=.05).sum(axis=0)[j]>1
                event='split/merge contribution' if split and merge else 'split contribution' if split else 'merge contribution' if merge else 'secondary overlap'
                assert row.LineageEvent==event
        assert actual_secondary==expected_secondary,(cycle,'secondary overlap completeness')
        for row in active.itertuples(index=False):
            details=json.loads(row.Fuzzy_Membership_Details)
            assert len(details)==len(actual_centres)
            assert {int(detail['cluster_index']) for detail in details}==set(range(len(actual_centres)))
            assert all(actual_ids[int(detail['cluster_index'])]==detail['stable_cluster_id'] for detail in details)
        inactive=current.loc[current.Activity_Status.eq('Inactive')]
        assert inactive.Is_Model_Fit.eq(1).all()
        assert inactive.Assignment_Mode.eq('Current-cycle fuzzy fit').all()
        record['lineage']={'fitted_IDs_complete':len(actual_ids),'continued':len(pairs),'created':len(actual_created),'retired':len(actual_retired),'secondary_overlap_rows':len(actual_secondary),'freshly_fitted_inactive_customers_checked':len(inactive)}
        outputs.append(record)
        total_lineage_rows+=len(actual_history)
        previous=current
        previous_centres=actual_centres
        ids=actual_ids
    return {'status':'passed','run_directory':str(run),'method':'Independent reconstruction from stored customer vectors, PCA coordinates, saved baseline K-means centres and documented mathematical rules; no csrs_model imports/calls.',
            'retained_candidates_checked':sum(row['incremental_candidate_present'] for row in outputs),'selected_retained_updates_checked':total_retained,'maximum_selected_retained_centre_residual':max_selected_centre_error,'maximum_retained_candidate_objective_residual':max_retained_objective_error,
            'split_initializations_replayed':split_starts_checked,'selected_splits_replayed':selected_splits_checked,'maximum_split_candidate_XB_residual':max_split_score_error,'maximum_selected_split_centre_residual_after_permutation':max_selected_split_centre_error,
            'lineage_rows_checked':total_lineage_rows,'maximum_lineage_residuals':max_lineage_error,
            'limitations':['Prior mass applies only to absent customer IDs. In this fullpopulation replacement run every prior ID is present, so mass is zero and previous centres provide initialization without extra historical observationweight.', 'Secondary lineage split/merge contribution labels describe membership-overlap topology; they do not independently demonstrate a selected structural split or merge. Structural decisions are reported by the selected MDFCM operation.', 'Every inactive customer receives fresh membership to current fitted centres. No retired historical ID is carried forward as a current assignment.', 'All production K+1 initializations and FCM iterations are independently replayed; no K-1 candidate is eligible in this dataset, so its actual structural output remains covered by separate synthetic checks rather than a fabricated research event.'],
            'cycles':outputs}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir',type=Path,required=True)
    args=parser.parse_args()
    report=audit(args.run_dir.resolve())
    output=args.run_dir/'centroid_update_audit.json'
    output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({key:value for key,value in report.items() if key not in ['cycles','limitations']},indent=2))

if __name__=='__main__':
    main()
