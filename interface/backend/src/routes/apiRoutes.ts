import { Router } from "express";
import { ApiController } from "../controllers/apiController";

const controller = new ApiController();
export const apiRouter = Router();

/**
 * @swagger
 * /api/overview:
 *   get:
 *     summary: Overview metrics
 *     responses:
 *       200:
 *         description: Overview payload
 */
apiRouter.get("/overview", async (req, res) => {
  console.log(">>> /api/overview HIT");

  try {
    await controller.dashboardOverview(req, res);
    console.log(">>> dashboardOverview completed");
  } catch (err) {
    console.error(">>> dashboardOverview threw:", err);
    res.status(500).json(err);
  }
});
apiRouter.get("/dashboard/overview", controller.dashboardOverview.bind(controller));

/**
 * @swagger
 * /api/model/evaluation:
 *   get:
 *     summary: Model evaluation metrics
 */
apiRouter.get("/model/evaluation", controller.modelEvaluation.bind(controller));
apiRouter.get("/model/evaluation/detailed", controller.modelEvaluationDetailed.bind(controller));

apiRouter.get("/segments", controller.segments.bind(controller));
apiRouter.get("/segments/:segment", controller.segmentByName.bind(controller));
apiRouter.get("/customers", controller.customers.bind(controller));
apiRouter.get("/customers/:id", controller.customerById.bind(controller));
apiRouter.get("/migration", controller.migration.bind(controller));
apiRouter.get("/cycles", controller.cycles.bind(controller));
apiRouter.get("/cycles/:cycleId/overview", controller.cycleOverview.bind(controller));
apiRouter.get("/schema", controller.schema.bind(controller));
apiRouter.get("/tables/:table", controller.tableRows.bind(controller));
apiRouter.get("/filters", controller.filterOptions.bind(controller));
apiRouter.get("/features/summary", controller.featureSummary.bind(controller));
apiRouter.get("/features/correlation", controller.featureCorrelation.bind(controller));
apiRouter.get("/artifacts", controller.artifacts.bind(controller));
apiRouter.get("/charts", controller.charts.bind(controller));
apiRouter.get("/images", controller.images.bind(controller));
apiRouter.get("/images/:kind", controller.imageByKind.bind(controller));
apiRouter.get("/html/:kind", controller.htmlByKind.bind(controller));
apiRouter.get("/reports", controller.reports.bind(controller));
apiRouter.get("/search", controller.search.bind(controller));
apiRouter.get("/recommendations/:segment", controller.recommendations.bind(controller));
apiRouter.get("/files/:path(*)", controller.file.bind(controller));
