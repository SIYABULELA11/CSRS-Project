import { Request, Response } from "express";
import { DashboardService } from "../services/dashboardService";
import { SegmentService } from "../services/segmentService";
import { CustomerService } from "../services/customerService";
import { MigrationService } from "../services/migrationService";
import { ArtifactService } from "../services/artifactService";
import { SearchService } from "../services/searchService";
import { AnalyticsService } from "../services/analyticsService";

const dashboardService = new DashboardService();
const segmentService = new SegmentService();
const customerService = new CustomerService();
const migrationService = new MigrationService();
const artifactService = new ArtifactService();
const searchService = new SearchService();
const analyticsService = new AnalyticsService();

export class ApiController {
  async dashboardOverview(_req: Request, res: Response): Promise<void> {
    const data = await dashboardService.getOverview();
    res.json(data);
  }

  async modelEvaluation(_req: Request, res: Response): Promise<void> {
    const data = await dashboardService.getModelEvaluation();
    res.json(data);
  }

  modelEvaluationDetailed(_req: Request, res: Response): void {
    res.json(analyticsService.getModelEvaluationDetailed());
  }

  async segments(_req: Request, res: Response): Promise<void> {
    const data = await segmentService.getSegments();
    res.json(data);
  }

  async segmentByName(req: Request, res: Response): Promise<void> {
    const data = await segmentService.getSegmentByName(req.params.segment);
    if (!data) {
      res.status(404).json({ message: "Segment not found" });
      return;
    }
    res.json(data);
  }

  customers(req: Request, res: Response): void {
    const data = customerService.getCustomers(req.query);
    res.json(data);
  }

  customerById(req: Request, res: Response): void {
    const data = customerService.getCustomerProfile(req.params.id);
    if (!data) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    res.json(data);
  }

  async migration(_req: Request, res: Response): Promise<void> {
    const data = await migrationService.getMigration();
    res.json(data);
  }

  cycles(_req: Request, res: Response): void {
    const data = migrationService.getCycles();
    res.json(data);
  }

  cycleOverview(req: Request, res: Response): void {
    res.json(analyticsService.getCycleOverview(req.params.cycleId));
  }

  schema(_req: Request, res: Response): void {
    res.json(analyticsService.getSchema());
  }

  tableRows(req: Request, res: Response): void {
    try {
      const payload = analyticsService.getTableRows(req.params.table, req.query as Record<string, unknown>);
      res.json(payload);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  }

  filterOptions(_req: Request, res: Response): void {
    res.json(analyticsService.getFilterOptions());
  }

  featureSummary(req: Request, res: Response): void {
    const cycleId = typeof req.query.cycleId === "string" ? req.query.cycleId : undefined;
    res.json(analyticsService.getFeatureSummary(cycleId));
  }

  featureCorrelation(req: Request, res: Response): void {
    const cycleId = typeof req.query.cycleId === "string" ? req.query.cycleId : undefined;
    res.json(analyticsService.getFeatureCorrelation(cycleId));
  }

  customerAnalytics(_req: Request, res: Response): void {
    res.json(analyticsService.getCustomerAnalytics());
  }

  productAnalytics(_req: Request, res: Response): void {
    res.json(analyticsService.getProductAnalytics());
  }

  geographicAnalytics(_req: Request, res: Response): void {
    res.json(analyticsService.getGeographicAnalytics());
  }

  artifacts(req: Request, res: Response): void {
    const category = typeof req.query.category === "string" ? req.query.category : "";
    if (!category) {
      res.json(artifactService.getAll());
      return;
    }
    res.json(artifactService.getByCategory(category));
  }

  charts(_req: Request, res: Response): void {
    res.json(artifactService.getCharts());
  }

  images(_req: Request, res: Response): void {
    res.json(artifactService.getByCategory("images"));
  }

  imageByKind(req: Request, res: Response): void {
    res.json(artifactService.getByCategory(req.params.kind));
  }

  htmlByKind(req: Request, res: Response): void {
    res.json(artifactService.getByCategory(req.params.kind).filter((a) => a.ext === ".html"));
  }

  reports(_req: Request, res: Response): void {
    res.json(artifactService.getReports());
  }

  file(req: Request, res: Response): void {
    try {
      const abs = artifactService.resolveRelativePath(req.params.path);
      res.sendFile(abs);
    } catch (error) {
      res.status(404).json({ message: (error as Error).message });
    }
  }

  search(req: Request, res: Response): void {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.status(400).json({ message: "q is required" });
      return;
    }

    res.json(searchService.search(q));
  }

  async recommendations(req: Request, res: Response): Promise<void> {
    const data = await segmentService.getRecommendations(req.params.segment);
    res.json(data);
  }
}
