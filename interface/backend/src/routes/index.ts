import { Router } from "express";
import { apiRouter } from "./apiRoutes";

export const router = Router();

router.get("/health", (_req, res) => {
	res.json({
    status: "ok",
    commit: process.env.RENDER_GIT_COMMIT ?? null,
    modelRun: process.env.CSRS_MODEL_RUN ?? null,
    databaseSha256: process.env.CSRS_DATABASE_SHA256 ?? null,
  });
});

router.use("/api", apiRouter);
