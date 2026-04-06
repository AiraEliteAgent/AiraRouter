import { CORS_ORIGIN } from "@/shared/utils/cors";
import { handleImageGeneration } from "@airarouter/open-sse/handlers/imageGeneration.ts";
import {
  getProviderCredentials,
  clearRecoveredProviderState,
  extractApiKey,
  isValidApiKey,
} from "@/sse/services/auth";
import {
  parseImageModel,
  getAllImageModels,
  getImageProvider,
} from "@airarouter/open-sse/config/imageRegistry.ts";
import { errorResponse, unavailableResponse } from "@airarouter/open-sse/utils/error.ts";
import { HTTP_STATUS } from "@airarouter/open-sse/config/constants.ts";
import * as log from "@/sse/utils/logger";
import { toJsonErrorPayload } from "@/shared/utils/upstreamError";
import { enforceApiKeyPolicy } from "@/shared/utils/apiKeyPolicy";
import { v1ImageGenerationSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

import { getAllCustomModels } from "@/lib/localDb";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/images/generations — list available image models
 */
export async function GET() {
  const builtInModels = getAllImageModels();
  const timestamp = Math.floor(Date.now() / 1000);

  const data = builtInModels.map((m) => ({
    id: m.id,
    object: "model",
    created: timestamp,
    owned_by: m.provider,
    type: "image",
    supported_sizes: m.supportedSizes,
  }));

  // Include custom models tagged for images
  try {
    const customModelsMap = (await getAllCustomModels()) as Record<string, any>;
    for (const [providerId, models] of Object.entries(customModelsMap)) {
      if (!Array.isArray(models)) continue;
      for (const model of models) {
        if (!model?.id || !Array.isArray(model.supportedEndpoints)) continue;
        if (!model.supportedEndpoints.includes("images")) continue;
        const fullId = `${providerId}/${model.id}`;
        if (data.some((d) => d.id === fullId)) continue;
        data.push({
          id: fullId,
          object: "model",
          created: timestamp,
          owned_by: providerId,
          type: "image",
          supported_sizes: null,
        });
      }
    }
  } catch {}

  return new Response(JSON.stringify({ object: "list", data }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /v1/images/generations — generate images
 */
export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    log.warn("IMAGE", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const validation = validateBody(v1ImageGenerationSchema, rawBody);
  if (isValidationFailure(validation)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, validation.error.message);
  }
  const body = validation.data;

  // Optional API key validation
  if (process.env.REQUIRE_API_KEY === "true") {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  // Enforce API key policies (model restrictions + budget limits)
  const policy = await enforceApiKeyPolicy(request, body.model);
  if (policy.rejection) return policy.rejection;

  // Parse model to get provider
  let { provider } = parseImageModel(body.model);
  let isCustomModel = false;

  // If not in built-in registry, check custom models tagged for images
  if (!provider) {
    try {
      const customModelsMap = (await getAllCustomModels()) as Record<string, any>;
      for (const [providerId, models] of Object.entries(customModelsMap)) {
        if (!Array.isArray(models)) continue;
        for (const model of models) {
          if (!model?.id || !Array.isArray(model.supportedEndpoints)) continue;
          if (!model.supportedEndpoints.includes("images")) continue;
          const fullId = `${providerId}/${model.id}`;
          if (fullId === body.model) {
            provider = providerId;
            isCustomModel = true;
            break;
          }
        }
        if (provider) break;
      }
    } catch {}
  }

  if (!provider) {
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Invalid image model: ${body.model}. Use format: provider/model`
    );
  }

  // Special handling for Antigravity: route to /v1/messages instead
  if (provider === "antigravity") {
    // Convert OpenAI format to Anthropic Messages format
    const messagesBody = {
      model: body.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: body.prompt,
        },
      ],
    };

    // Call /v1/messages internally
    const messagesResponse = await fetch("http://127.0.0.1:20129/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(messagesBody),
    });

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text();
      return new Response(errorText, {
        status: messagesResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const messagesData = await messagesResponse.json();

    // Convert Anthropic Messages response back to OpenAI format
    const images = [];
    for (const content of messagesData.content || []) {
      if (content.type === "image" && content.source?.data) {
        images.push({
          b64_json: content.source.data,
          revised_prompt: body.prompt,
        });
      }
    }

    return new Response(
      JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: images,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Check provider config for auth bypass
  const providerConfig = getImageProvider(provider);

  // Get credentials — skip for local providers (authType: "none") and proxy providers (authType: "proxy")
  let credentials = null;
  if (providerConfig && providerConfig.authType !== "none" && providerConfig.authType !== "proxy") {
    credentials = await getProviderCredentials(provider);
    if (!credentials) {
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `No credentials for image provider: ${provider}`
      );
    }
    if (credentials.allRateLimited) {
      return unavailableResponse(
        HTTP_STATUS.RATE_LIMITED,
        `[${provider}] All accounts rate limited`,
        credentials.retryAfter,
        credentials.retryAfterHuman
      );
    }
  } else if (isCustomModel) {
    credentials = await getProviderCredentials(provider);
    if (!credentials) {
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `No credentials for custom image provider: ${provider}`
      );
    }
    if (credentials.allRateLimited) {
      return unavailableResponse(
        HTTP_STATUS.RATE_LIMITED,
        `[${provider}] All accounts rate limited`,
        credentials.retryAfter,
        credentials.retryAfterHuman
      );
    }
  }

  const result = await handleImageGeneration({
    body,
    credentials,
    log,
    ...(isCustomModel && { resolvedProvider: provider }),
  });

  if (result.success) {
    await clearRecoveredProviderState(credentials);
    return new Response(JSON.stringify((result as any).data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const errorPayload = toJsonErrorPayload((result as any).error, "Image generation provider error");
  return new Response(JSON.stringify(errorPayload), {
    status: (result as any).status,
    headers: { "Content-Type": "application/json" },
  });
}
