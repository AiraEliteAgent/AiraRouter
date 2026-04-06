import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  isCloudEnabled,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  isClaudeCodeCompatibleProvider,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/lib/cloudSync";
import { createProviderSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { normalizeQoderPatProviderData } from "@airarouter/open-sse/services/qoderCli.ts";

// GET /api/providers - List all connections
export async function GET() {
  try {
    const connections = await getProviderConnections();

    // Hide sensitive fields
    const safeConnections = connections.map((c) => ({
      ...c,
      apiKey: undefined,
      accessToken: undefined,
      refreshToken: undefined,
      idToken: undefined,
    }));

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Zod validation
    const validation = validateBody(createProviderSchema, body);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const {
      provider,
      apiKey,
      name,
      priority,
      globalPriority,
      defaultModel,
      testStatus,
      providerSpecificData: incomingPsd,
    } = validation.data;

    // Business validation
    const isValidProvider =
      APIKEY_PROVIDERS[provider] ||
      provider === "qoder" ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider);

    if (!isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    let providerSpecificData = incomingPsd || null;
    const allowMultipleCompatibleConnections =
      process.env.ALLOW_MULTI_CONNECTIONS_PER_COMPAT_NODE === "true";

    if (provider === "qoder") {
      providerSpecificData = normalizeQoderPatProviderData(providerSpecificData || {});
    }

    if (isOpenAICompatibleProvider(provider)) {
      let node: any = await getProviderNodeById(provider);
      
      // Auto-create node if not found (9router-style)
      if (!node) {
        // Extract info from providerSpecificData
        const { baseUrl, prefix, apiType = "chat", chatPath, modelsPath } = providerSpecificData || {};
        
        if (!baseUrl || !prefix) {
          return NextResponse.json(
            { error: "Missing required fields: baseUrl and prefix are required for new OpenAI Compatible providers" },
            { status: 400 }
          );
        }
        
        // Create provider node automatically
        const { createProviderNode } = await import("@/lib/db/providers");
        const { generateId } = await import("@/shared/utils");
        
        node = await createProviderNode({
          id: provider,
          type: "openai-compatible",
          name: name,
          prefix: prefix,
          apiType: apiType,
          baseUrl: baseUrl,
          chatPath: chatPath || null,
          modelsPath: modelsPath || null,
        });
      }

      const existingConnections = await getProviderConnections({ provider });
      if (!allowMultipleCompatibleConnections && existingConnections.length > 0) {
        return NextResponse.json(
          { error: "Only one connection is allowed for this OpenAI Compatible node" },
          { status: 400 }
        );
      }

      providerSpecificData = {
        ...(providerSpecificData || {}),
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
        ...(node.chatPath ? { chatPath: node.chatPath } : {}),
        ...(node.modelsPath ? { modelsPath: node.modelsPath } : {}),
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      let node: any = await getProviderNodeById(provider);
      
      // Auto-create node if not found (9router-style)
      if (!node) {
        // Extract info from providerSpecificData
        const { baseUrl, prefix, chatPath, modelsPath } = providerSpecificData || {};
        
        if (!baseUrl || !prefix) {
          return NextResponse.json(
            { error: "Missing required fields: baseUrl and prefix are required for new Anthropic Compatible providers" },
            { status: 400 }
          );
        }
        
        // Create provider node automatically
        const { createProviderNode } = await import("@/lib/db/providers");
        
        const nodeType = isClaudeCodeCompatibleProvider(provider) 
          ? "claude-code-compatible" 
          : "anthropic-compatible";
        
        node = await createProviderNode({
          id: provider,
          type: nodeType,
          name: name,
          prefix: prefix,
          baseUrl: baseUrl,
          chatPath: chatPath || null,
          modelsPath: modelsPath || null,
        });
      }

      const existingConnections = await getProviderConnections({ provider });
      if (!allowMultipleCompatibleConnections && existingConnections.length > 0) {
        return NextResponse.json(
          { error: "Only one connection is allowed for this Anthropic Compatible node" },
          { status: 400 }
        );
      }

      providerSpecificData = {
        ...(providerSpecificData || {}),
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
        ...(node.chatPath ? { chatPath: node.chatPath } : {}),
        ...(node.modelsPath ? { modelsPath: node.modelsPath } : {}),
      };
    }

    const newConnection = await createProviderConnection({
      provider,
      authType: "apikey",
      name,
      apiKey,
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData,
      isActive: true,
      testStatus: testStatus || "unknown",
    });

    // Note: Gemini model sync is now triggered client-side with progress dialog

    // Hide sensitive fields
    const result: Record<string, any> = { ...newConnection };
    delete result.apiKey;

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}

/**
 * Sync to Cloud if enabled
 */
async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing providers to cloud:", error);
  }
}
