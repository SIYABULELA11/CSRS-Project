import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import path from "path";
import { env } from "./config/env";
import { router } from "./routes";
import { notFoundHandler } from "./middleware/notFound";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowedOrigins = [
        ...env.corsOrigins,
        "https://csrs-project.onrender.com",
      ];

      const isAllowed =
        allowedOrigins.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`Blocked CORS origin: ${origin}`);
        callback(null, false);
      }
    },
  })
);

app.use(compression());
app.use(morgan("combined"));
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.redirect(302, "/CSRS/");
});

app.use(
  "/public",
  express.static(path.resolve(__dirname, "..", "public"), {
    maxAge: "1h",
    index: false,
  })
);

const frontendDistPath = path.resolve(
  __dirname,
  "..",
  "..",
  "frontend",
  "dist"
);

app.use(
  "/CSRS",
  express.static(frontendDistPath, {
    maxAge: "1h",
  })
);

app.get("/CSRS/*", (_req, res) => {
  res.sendFile(path.join(frontendDistPath, "index.html"));
});

app.use(router);

app.use(notFoundHandler);
app.use(errorHandler);
