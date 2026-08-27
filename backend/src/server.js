import { createApp } from "./app.js";
import { config } from "./config/index.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Backend server listening on port ${config.port}`);
  console.log(`Proxying ML service at ${config.mlServiceUrl}`);
});

export default app;
