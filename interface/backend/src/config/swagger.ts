import swaggerJsdoc from "swagger-jsdoc";
import { env } from "./env";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "CSRS Backend API",
      version: "1.0.0",
      description: "REST API for customer segmentation and recommendation overview",
    },
    servers: [
      {
        url: `http://localhost:${env.port}`,
      },
    ],
  },
  apis: ["./src/routes/*.ts"],
});
