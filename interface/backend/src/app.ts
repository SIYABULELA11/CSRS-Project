import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import path from "path";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { router } from "./routes";
import { notFoundHandler } from "./middleware/notFound";
import { errorHandler } from "./middleware/errorHandler";
import { swaggerSpec } from "./config/swagger";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const isConfigured = env.corsOrigins.includes(origin);
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

      if (isConfigured || isLocalhost) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  }),
);
app.use(compression());
app.use(morgan("combined"));
app.use(express.json({ limit: "2mb" }));

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(
  "/public",
  express.static(path.resolve(__dirname, "..", "public"), {
    maxAge: "1h",
    index: false,
  }),
);

app.use(router);
app.use(notFoundHandler);
app.use(errorHandler);
