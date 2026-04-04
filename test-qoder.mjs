import { QoderExecutor } from "./open-sse/executors/qoder.ts";

const executor = new QoderExecutor();

async function run() {
  const result = await executor.execute({
    model: "qoder-rome-30ba3b",
    body: {
      messages: [{ role: "user", content: "Tell me a joke" }],
    },
    stream: true,
    credentials: {
      apiKey: "sk-e8c0dcd74739da8faad1dc4b3592bda8",
      email: "diegosouza.pw@gmail.com",
    },
    upstreamExtraHeaders: {},
  });

  console.log("Status:", result.response.status);

  if (result.response.body && result.response.body.getReader) {
    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let count = 0;
    while (true && count < 5) {
      const { done, value } = await reader.read();
      if (done) break;
      console.log("Chunk:", decoder.decode(value));
      count++;
    }
  } else {
    console.log("Body:", await result.response.text());
  }
}

run().catch(console.error);
