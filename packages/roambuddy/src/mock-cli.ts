import { createMockRoamBuddy } from "./mock.ts";

const port = Number(process.env.MOCK_PORT ?? 4100);
createMockRoamBuddy().server.listen(port, () => {
  console.log(`Mock RoamBuddy on http://localhost:${port}/api/v1 (any username/password logs in)`);
});
