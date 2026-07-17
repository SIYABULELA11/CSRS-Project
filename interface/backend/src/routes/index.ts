import { Router } from "express";
import { apiRouter } from "./apiRoutes";

export const router = Router();

router.get("/health", (_req, res) => {
	res.json({ status: "ok" });
});

router.use("/api", apiRouter);
