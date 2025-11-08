/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
exports.handler = async (event) => {
  console.log(`EVENT: ${JSON.stringify(event)}`);

  try {
    // Extract the prompt from the request body
    const body = JSON.parse(event.body || "{}");
    const { prompt } = body;

    if (!prompt?.trim()) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Access-Token",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
        body: JSON.stringify({ error: "Bad Request: Empty prompt" }),
      };
    }

    // Get the access token from the custom header (for AgentCore)
    // Note: Authorization header contains ID token (already validated by API Gateway)
    // X-Access-Token header contains access token (needed by AgentCore for client_id validation)
    const accessToken =
      event.headers?.["X-Access-Token"] || event.headers?.["x-access-token"];

    if (!accessToken) {
      console.error("Missing X-Access-Token header. Headers:", event.headers);
      return {
        statusCode: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Access-Token",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
        body: JSON.stringify({
          error: "Unauthorized: Missing X-Access-Token header",
        }),
      };
    }

    console.log("Access token received, length:", accessToken.length);

    // Call AgentCore and get the complete response
    const response = await callAgentCore(accessToken, prompt.trim());

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Access-Token",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Lambda error:", error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Access-Token",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify({
        error: `Internal Server Error: ${error.message}`,
      }),
    };
  }
};

/**
 * Call AWS Bedrock AgentCore and collect the complete response
 * @param {string} accessToken - Cognito access token
 * @param {string} prompt - User prompt
 * @returns {Promise<Object>} - Complete response from AgentCore
 */
async function callAgentCore(accessToken, prompt) {
  const BEDROCK_AGENT_CORE_ENDPOINT_URL =
    "https://bedrock-agentcore.ap-northeast-1.amazonaws.com";
  const agentArn = process.env.AGENT_CORE_ARN || "";

  if (!agentArn) {
    throw new Error("AGENT_CORE_ARN environment variable is not set");
  }

  const fullUrl = `${BEDROCK_AGENT_CORE_ENDPOINT_URL}/runtimes/${encodeURIComponent(
    agentArn
  )}/invocations`;

  console.log("Calling AgentCore:", fullUrl);

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ prompt }),
  });

  console.log("AgentCore response status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AgentCore error:", errorText);
    throw new Error(
      `AgentCore returned ${response.status}: ${response.statusText} - ${errorText}`
    );
  }

  if (!response.body) {
    throw new Error("No response body from AgentCore");
  }

  // Collect all chunks from the streaming response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) continue;

        console.log("Received line:", line);

        // Process SSE data
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            console.log("Stream completed");
            break;
          }

          try {
            const parsed = JSON.parse(data);
            console.log("Parsed data:", parsed);

            let textContent = "";
            if (parsed.event?.contentBlockDelta?.delta?.text) {
              textContent = parsed.event.contentBlockDelta.delta.text;
            } else if (parsed.text) {
              textContent = parsed.text;
            } else if (typeof parsed === "string") {
              textContent = parsed;
            }

            if (textContent) {
              fullText += textContent;
            }
          } catch (parseError) {
            console.error("JSON parse error:", parseError, "for data:", data);
          }
        } else {
          // Try parsing as direct JSON
          try {
            const parsed = JSON.parse(line);
            console.log("Parsed direct JSON:", parsed);

            let textContent = "";
            if (parsed.event?.contentBlockDelta?.delta?.text) {
              textContent = parsed.event.contentBlockDelta.delta.text;
            } else if (parsed.text) {
              textContent = parsed.text;
            } else if (typeof parsed === "string") {
              textContent = parsed;
            }

            if (textContent) {
              fullText += textContent;
            }
          } catch (parseError) {
            console.error(
              "Direct JSON parse error:",
              parseError,
              "for line:",
              line
            );
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        console.log("Parsed remaining buffer:", parsed);

        let textContent = "";
        if (parsed.event?.contentBlockDelta?.delta?.text) {
          textContent = parsed.event.contentBlockDelta.delta.text;
        } else if (parsed.text) {
          textContent = parsed.text;
        } else if (typeof parsed === "string") {
          textContent = parsed;
        }

        if (textContent) {
          fullText += textContent;
        }
      } catch (parseError) {
        console.error("Buffer parse error:", parseError, "for buffer:", buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: fullText,
    completed: true,
  };
}
