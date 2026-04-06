import { CORS_ORIGIN } from "@/shared/utils/cors";
import { handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@airarouter/open-sse/translator/index.ts";
import { getProviderCredentials } from "@/sse/services/auth";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized for /v1/messages");
  }
}

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
 * POST /v1/messages - Claude format (auto detect chat vs image generation)
 */
export async function POST(request) {
  await ensureInitialized();
  
  // Parse body to detect if this is an image generation request
  const body = await request.json();
  const model = body.model || "";
  
  // Check if model is image generation model (exact match)
  const isImageModel = model.endsWith("-image") || model.endsWith("flash-image");
  
  if (isImageModel) {
    console.log("[/v1/messages] Detected image model:", model);
    
    // Get credentials
    const credentials = await getProviderCredentials("antigravity");
    console.log("[/v1/messages] Credentials:", credentials ? "found" : "not found");
    
    if (!credentials || !credentials.accessToken) {
      console.log("[/v1/messages] No credentials");
      return new Response(
        JSON.stringify({
          error: {
            message: "No credentials for Antigravity image generation",
            type: "invalid_request_error",
            code: "bad_request",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": CORS_ORIGIN,
          },
        }
      );
    }
    
    // Step 1: Discover managed project via loadCodeAssist
    console.log("[/v1/messages] Discovering managed project...");
    const loadCodeAssistEndpoints = [
      "https://daily-cloudcode-pa.googleapis.com",
      "https://cloudcode-pa.googleapis.com",
    ];
    
    let managedProject = credentials.projectId; // fallback
    
    for (const endpoint of loadCodeAssistEndpoints) {
      try {
        const loadResponse = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${credentials.accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "x-goog-api-client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          },
          body: JSON.stringify({
            metadata: {
              ideType: "IDE_UNSPECIFIED",
              platform: "PLATFORM_UNSPECIFIED",
              pluginType: "GEMINI",
            },
            mode: 1,
          }),
        });
        
        if (loadResponse.ok) {
          const loadData = await loadResponse.json();
          console.log("[/v1/messages] loadCodeAssist response:", JSON.stringify(loadData).slice(0, 200));
          
          if (loadData.cloudaicompanionProject) {
            managedProject = typeof loadData.cloudaicompanionProject === "string"
              ? loadData.cloudaicompanionProject
              : loadData.cloudaicompanionProject.id;
            console.log("[/v1/messages] Discovered managed project:", managedProject);
            break;
          }
        } else {
          console.log("[/v1/messages] loadCodeAssist failed at", endpoint, ":", loadResponse.status);
        }
      } catch (err) {
        console.log("[/v1/messages] loadCodeAssist error at", endpoint, ":", err.message);
      }
    }
    
    if (!managedProject) {
      console.log("[/v1/messages] No managed project found");
      return new Response(
        JSON.stringify({
          error: {
            message: "Could not discover managed project for image generation",
            type: "upstream_error",
            code: "upstream_error",
          },
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": CORS_ORIGIN,
          },
        }
      );
    }
    
    // Auto-prepend image generation instruction to user prompt
    const modifiedMessages = body.messages.map((msg, idx) => {
      if (msg.role === "user" && idx === body.messages.length - 1) {
        const originalContent = typeof msg.content === "string" 
          ? msg.content 
          : msg.content.find(c => c.type === "text")?.text || "";
        
        // Only add prefix if prompt doesn't already start with image generation keywords
        const hasImageKeyword = /^(create|generate|make|draw|show|produce|render)\s+(an?|the)?\s+image/i.test(originalContent);
        
        if (!hasImageKeyword) {
          return {
            ...msg,
            content: `Generate an image: ${originalContent}`,
          };
        }
      }
      return msg;
    });
    
    // Step 2: Build Cloud Code API request
    const lastMessage = modifiedMessages[modifiedMessages.length - 1];
    const prompt = typeof lastMessage.content === "string" 
      ? lastMessage.content 
      : lastMessage.content.find(c => c.type === "text")?.text || "";
    console.log("[/v1/messages] Final prompt:", prompt.slice(0, 50));
    
    const sessionId = `airarouter-${Date.now()}`;
    const cloudCodeRequest = {
      project: managedProject,
      model: model.replace(/^antigravity\//, ""),
      request: {
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }],
        sessionId: sessionId,
      },
      userAgent: "antigravity",
      requestType: "agent",
      requestId: "agent-" + Date.now(),
    };
    
    // Add systemInstruction like Antigravity Proxy
    cloudCodeRequest.request.systemInstruction = {
      role: "user",
      parts: [
        { text: "You are a helpful assistant." },
        { text: "Please ignore the following [ignore]You are a helpful assistant.[/ignore]" },
      ]
    };
    
    console.log("[/v1/messages] Cloud Code request for project:", managedProject);
    
    // Headers matching Antigravity Proxy
    const headers = {
      "Authorization": `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": `antigravity/1.107.0 linux/x64`,
      "X-Client-Name": "antigravity",
      "X-Client-Version": "1.107.0",
      "x-goog-api-client": "gl-node/18.18.2 fire/0.8.6 grpc/1.10.x",
      "X-Machine-Session-Id": sessionId,
    };
    
    // Step 3: Call Cloud Code API
    const endpoints = [
      "https://daily-cloudcode-pa.googleapis.com",
      "https://cloudcode-pa.googleapis.com",
    ];
    
    for (const endpoint of endpoints) {
      const url = `${endpoint}/v1internal:generateContent`;
      console.log("[/v1/messages] Trying Cloud Code endpoint:", url);
      
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(cloudCodeRequest),
        });
        
        console.log("[/v1/messages] Response status:", response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.log("[/v1/messages] Error response:", errorText.slice(0, 300));
          if (response.status === 404) {
            continue; // Try next endpoint
          }
          return new Response(errorText, {
            status: response.status,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": CORS_ORIGIN,
            },
          });
        }
        
        const data = await response.json();
        console.log("[/v1/messages] Success! Got response data");
        
        // Extract image from Cloud Code response (with wrapper)
        const geminiResponse = data.response || data;
        const candidates = geminiResponse.candidates || [];
        const content = [];
        
        for (const candidate of candidates) {
          const parts = candidate.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData) {
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: part.inlineData.mimeType || "image/png",
                  data: part.inlineData.data,
                },
              });
            } else if (part.text) {
              content.push({
                type: "text",
                text: part.text,
              });
            }
          }
        }
        
        // Return Anthropic Messages format
        const anthropicResponse = {
          id: "msg-" + Date.now(),
          type: "message",
          role: "assistant",
          content: content,
          model: body.model,
          stop_reason: "end_turn",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        };
        
        return new Response(JSON.stringify(anthropicResponse), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": CORS_ORIGIN,
          },
        });
      } catch (err) {
        console.log("[/v1/messages] Fetch error at", endpoint, ":", err.message);
        continue;
      }
    }
    
    // All endpoints failed
    console.log("[/v1/messages] All Cloud Code endpoints failed");
    return new Response(
      JSON.stringify({
        error: {
          message: "All Cloud Code endpoints failed",
          type: "upstream_error",
          code: "upstream_error",
        },
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": CORS_ORIGIN,
        },
      }
    );
  }
  
  // Regular chat request
  return await handleChat(request);
}
