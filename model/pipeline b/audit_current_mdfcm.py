"""Independent arithmetic and decision audit of an executed research database."""
from __future__ import annotations
import argparse
import json
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score


def membership(points, centres, m=2.):
    squared = np.sum((points[:, None, :] - centres[None, :, :]) ** 2, axis=2)
    result = np.empty_like(squared)
    for index, distances in enumerate(squared):
        zeros = distances <= 1e-20
        if zeros.any():
            result[index] = zeros / zeros.sum()
        else:
            weights = distances ** (-1. / (m - 1.))
            result[index] = weights / weights.sum()
    return result, squared


def audit(directory: Path):
    db = sqlite3.connect(directory / 'csrs_pipeline_b_repaired.db')
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    baseline = pd.read_sql_query('SELECT * FROM Time_Cycle_0_Segmentation', db)
    previous = np.array(json.loads(baseline.Initial_Centroids.iloc[0]))
    points0 = baseline[['PC1','PC2','PC3']].to_numpy()
    assert np.array_equal(((points0[:,None,:]-previous[None,:,:])**2).sum(2).argmin(1), baseline.KMeans_Cluster_Number)
    summaries = pd.read_sql_query('SELECT * FROM Dynamic_Cycle_Summary', db)
    summaries['cycle_number'] = summaries.CycleID.str.replace('Cycle_','').astype(int)
    candidates = pd.read_sql_query('SELECT * FROM MDFCM_Candidate_Evaluations', db)
    cycles = []
    maximum_u_error = maximum_objective_error = maximum_xb_error = 0.
    for _, row in summaries.sort_values('cycle_number').iterrows():
        cycle = row.CycleID
        current = pd.read_sql_query('SELECT * FROM Dynamic_Loop_Results WHERE CycleID=?',db,params=[cycle])
        active = pd.read_sql_query("SELECT r.*, p.PC1,p.PC2,p.PC3 FROM Dynamic_Loop_Results r JOIN Data_Preprocessing_Results p ON p.CustomerID=r.CustomerID AND p.CycleID=r.CycleID WHERE r.CycleID=? AND r.Is_Model_Fit=1",db,params=[cycle])
        points = active[['PC1','PC2','PC3']].to_numpy()
        prior_u, prior_squared = membership(points, previous, float(row.Fuzziness))
        condition1 = np.all(np.abs(prior_u - 1./len(previous)) <= float(row.MDFCMAlpha), axis=1)
        # Exclude each self-pair explicitly; infinity must never enter a farthest-distance maximum.
        bounds = np.array([max(np.linalg.norm(centre-other) for j,other in enumerate(previous) if j != i)/2.
                           for i,centre in enumerate(previous)])
        assert np.isfinite(bounds).all()
        condition2 = np.all(np.sqrt(prior_squared) > bounds, axis=1)
        assert int(condition1.sum()) == int(row.Condition1ObservationCount), cycle
        assert int(condition2.sum()) == int(row.Condition2ObservationCount), cycle
        c1, c2, old_k = bool(condition1.any()), bool(condition2.any()), len(previous)
        expected = ({old_k-1,old_k,old_k+1} if c1 and c2 else {old_k-1,old_k+1} if c1
                    else {old_k,old_k+1} if c2 else {old_k})
        expected = {k for k in expected if 2 <= k <= len(points)}
        evaluated = candidates[candidates.CycleID.eq(cycle)]
        assert set(evaluated.CandidateK.astype(int)) == expected, cycle
        assert evaluated.Converged.eq(1).all() and np.isfinite(evaluated.XieBeniIndex).all()
        assert (evaluated.FinalObjectiveChange <= evaluated.ConvergenceTolerance+1e-12).all()
        assert int(evaluated.loc[evaluated.XieBeniIndex.idxmin(),'CandidateK']) == int(row.SelectedK)
        centres = pd.read_sql_query('SELECT PC1,PC2,PC3 FROM Dynamic_Centroids WHERE CycleID=? ORDER BY ClusterID',db,params=[cycle]).to_numpy()
        assert len(centres) == int(row.SelectedK)
        stored_u = np.array(active.All_Fuzzy_Memberships.map(json.loads).tolist())
        assert stored_u.shape == (len(points),len(centres)) and np.isfinite(stored_u).all()
        assert np.allclose(stored_u.sum(1),1.,atol=1e-7)
        expected_u, squared = membership(points,centres,float(row.Fuzziness))
        u_error = float(np.max(np.abs(stored_u-expected_u)))
        objective = float(np.sum(stored_u**float(row.Fuzziness)*squared))
        minimum_separation = min(np.sum((left-right)**2) for i,left in enumerate(centres) for j,right in enumerate(centres) if i<j)
        xb = objective/(len(points)*minimum_separation)
        maximum_u_error=max(maximum_u_error,u_error)
        maximum_objective_error=max(maximum_objective_error,abs(objective-row.FuzzyObjective))
        maximum_xb_error=max(maximum_xb_error,abs(xb-row.XieBeniIndex))
        assert u_error < 1e-7 and abs(objective-row.FuzzyObjective)<1e-5 and abs(xb-row.XieBeniIndex)<1e-6
        labels=stored_u.argmax(1)
        assert np.array_equal(labels,active.Cluster_Local_Index)
        for saved,computed in [(row.SilhouetteScore,silhouette_score(points,labels)),
                               (row.DaviesBouldinScore,davies_bouldin_score(points,labels)),
                               (row.CalinskiHarabaszScore,calinski_harabasz_score(points,labels))]:
            assert abs(saved-computed) < 1e-7 * max(1.,abs(saved)), (cycle,saved,computed)
        lineage=pd.read_sql_query("SELECT CurrentLocalCluster,CurrentStableClusterID FROM Cluster_Lineage WHERE CycleID=? AND (IsPrimaryMatch=1 OR LineageEvent='created')",db,params=[cycle])
        assert len(lineage)==len(centres) and lineage.CurrentLocalCluster.nunique()==len(centres)
        assert lineage.CurrentStableClusterID.nunique()==len(centres)
        cycles.append({'cycle':cycle,'previous_k':old_k,'selected_k':len(centres),'condition1_count':int(condition1.sum()),
                       'condition2_count':int(condition2.sum()),'evaluated_k':sorted(expected),
                       'selected_operation':row.SelectedOperation,'iterations':int(row.Iterations),
                       'hard_winners':len(set(labels)),'passed':True})
        previous=centres
    groups=set(baseline.Segment_Name)|set(pd.read_sql_query('SELECT DISTINCT Segment_Name FROM Dynamic_Loop_Results',db).Segment_Name)
    assert {g.split(' · ')[0] for g in groups} <= {'Champions','High-Value Regulars','Loyalists','Valuable Customers at Risk','Mid-Tier Occasionals','Occasional Buyers at Risk','Light Buyers','Light Buyers at Risk','Hibernating / Lost','Champions at Risk','Loyalist at Risk','Mid-Tier Occasional','Occasional at Risk','Developing','Developing at Risk'}
    result={'scope':'Executed research data; independent condition geometry, membership and validity arithmetic',
            'database_integrity':'ok','cycle0_nearest_centre_mismatches':0,'cycles':cycles,
            'max_membership_error':maximum_u_error,'max_objective_error':maximum_objective_error,
            'max_xie_beni_error':maximum_xb_error,'business_groups':sorted(groups),'passed':True}
    db.close()
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--run-dir',type=Path,required=True)
    args=parser.parse_args(); result=audit(args.run_dir)
    (args.run_dir/'independent_mdfcm_audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
