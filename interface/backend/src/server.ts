import { app } from "./app";
import { env } from "./config/env";

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`CSRS backend running on http://localhost:${env.port}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger docs on http://localhost:${env.port}/docs`);
});
