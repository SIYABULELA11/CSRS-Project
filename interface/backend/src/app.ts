import express from "express";
import path from "path";

export const app = express();

const frontendDistPath = path.resolve(__dirname, "..", "..", "frontend", "dist");

app.use("/CSRS", express.static(frontendDistPath));

app.get("/CSRS/*", (_req, res) => {
  res.sendFile(path.join(frontendDistPath, "index.html"));
});
