import { validateQoderCliPat } from "./open-sse/services/qoderCli.ts";

async function run() {
  const result = await validateQoderCliPat({ apiKey: "sk-e8c0dcd74739da8faad1dc4b3592bda8" });
  console.log(result);
}

run().catch(console.error);
