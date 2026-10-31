"""Export the current methodology as an editable SVG and a publication PNG/PDF."""
from pathlib import Path
import argparse
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrowPatch


def create_diagram(figure_root: Path):
    output = figure_root / 'Methodology'
    output.mkdir(exist_ok=True, parents=True)
    fig, ax = plt.subplots(figsize=(16, 9))
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis('off')
    def box(x, y, w, h, title, body):
        ax.add_patch(Rectangle((x,y),w,h,facecolor='white',edgecolor='#20252B',linewidth=1.0))
        ax.text(x+w/2,y+h-.027,title,ha='center',va='top',fontsize=11,weight='bold')
        ax.text(x+w/2,y+h-.069,body,ha='center',va='top',fontsize=9,linespacing=1.55)
    def arrow(a,b):
        ax.add_patch(FancyArrowPatch(a,b,arrowstyle='-|>',mutation_scale=12,color='#20252B',linewidth=1.0))
    ax.text(.5,.965,'Customer segmentation methodology',ha='center',va='top',fontsize=22,weight='bold')
    ax.text(.5,.919,'Cycle 0: static K-means  |  Cycles 1–9: MDFCM with complete customer snapshots',ha='center',fontsize=11)
    ax.text(.18,.87,'DATA PROCESSING',ha='center',fontsize=12,weight='bold')
    steps=[
        ('1  Data cleaning','Missing or invalid identifiers and dates;\npositive paid sales; remove exact duplicates'),
        ('2  Customer snapshots','Everyone observed before each cutoff;\nexact recency and trailing 90-day purchases'),
        ('3  RFM feature engineering','Days since purchase; invoice count and sales\nin the window, expressed as monthly rates'),
        ('4  Log transformation','log(1 + R), log(1 + F), log(1 + M);\nRF, RM and FM products of logged values'),
        ('5  MinMax scaling','Fit on Cycle 0 only; reuse the same\nsix-feature transformation in every cycle'),
        ('6  Principal component analysis','Fit three components on Cycle 0 only;\nreuse the same axes for fitting and plots'),
    ]
    for i,(title,body) in enumerate(steps):
        y=.726-i*.124
        box(.025,y,.31,.111,title,body)
        if i<5: arrow((.18,y),(.18,y-.013))
    ax.text(.56,.87,'CUSTOMER SEGMENTATION',ha='center',fontsize=12,weight='bold')
    box(.395,.66,.33,.177,'Cycle 0: K-means, K = 5','WCSS elbow selects K; silhouette supports review\nCrisp assignments and initial fitted centres\nSilhouette, Davies–Bouldin, CH and inertia')
    box(.395,.332,.33,.279,'Cycles 1–9: dynamic updates','Replace old snapshots with current customer records\nPrior centres initialize the update\nOld observations are not counted a second time\nMDFCM conditions permit K−1 / K / K+1\nFCM membership and centre updates\nSelect the eligible converged fit with lowest Xie–Beni\nTrack actual centres and current memberships')
    box(.395,.105,.33,.177,'Country-market analysis and integration','First five inputs log1p; all six RobustScaler\nK=2–10 WCSS elbow selects 4; silhouette supports\nFrozen Cycle 0 scaling and country centres\nCombine market groups with behavioural profiles')
    arrow((.335,.161),(.365,.161)); arrow((.365,.161),(.365,.746)); arrow((.365,.746),(.395,.746))
    arrow((.56,.66),(.56,.611)); arrow((.56,.332),(.56,.282))
    ax.text(.865,.87,'RESULTS',ha='center',fontsize=12,weight='bold')
    box(.785,.63,.19,.207,'Current fitted clusters','One visible entry per fitted centre\nNames based on weighted RFM\nHibernating / Lost: over 90 days\nSeparate customer risk warnings')
    box(.785,.355,.19,.225,'Evidence and interpretation','Metrics use the fitted population\nActual PCA centre movement\nK-selection and candidate results\nCustomer history and transactions\nMarket and product summaries')
    box(.785,.105,.19,.20,'Database and dashboard','Versioned SQLite and CSV outputs\nSaved transforms and figures\nIndependent numerical audits\nLocal dashboard at port 4000')
    arrow((.726,.47),(.755,.47)); arrow((.755,.47),(.755,.733)); arrow((.755,.733),(.785,.733))
    arrow((.865,.63),(.865,.58)); arrow((.865,.355),(.865,.305))
    ax.text(.5,.035,'Reporting names and customer warnings describe results; they do not determine the learned cluster count.',ha='center',fontsize=10)
    fig.subplots_adjust(left=.015,right=.985,bottom=.015,top=.985)
    for ext in ['svg','png','pdf']:
        fig.savefig(output/f'current_methodology.{ext}',dpi=220,facecolor='white',bbox_inches='tight')
    plt.close(fig)
    return str(output/'current_methodology.svg')


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--figure-root',type=Path,required=True)
    print(create_diagram(parser.parse_args().figure_root))
