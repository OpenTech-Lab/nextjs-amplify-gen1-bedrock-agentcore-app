/**
 * Lambda streaming handler for AgentCore chat
 * Streams responses in real-time using Lambda Function URL response streaming
 */
exports.handler = awslambda.streamifyResponse(async (event, responseStream) => {
  console.log(`EVENT: ${JSON.stringify(event)}`);

  // Set headers for streaming response (CORS handled by Function URL)
  const metadata = {
    statusCode: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  };

  try {
    // Parse request body
    const body = JSON.parse(event.body || "{}");
    const { prompt } = body;

    if (!prompt?.trim()) {
      metadata.statusCode = 400;
      metadata.headers["Content-Type"] = "application/json";
      responseStream = awslambda.HttpResponseStream.from(
        responseStream,
        metadata
      );
      responseStream.write(
        JSON.stringify({ error: "Bad Request: Empty prompt" })
      );
      responseStream.end();
      return;
    }

    // Get the access token from the custom header (for AgentCore)
    const accessToken =
      event.headers?.["x-access-token"] || event.headers?.["X-Access-Token"];

    if (!accessToken) {
      console.error("Missing X-Access-Token header");
      metadata.statusCode = 401;
      metadata.headers["Content-Type"] = "application/json";
      responseStream = awslambda.HttpResponseStream.from(
        responseStream,
        metadata
      );
      responseStream.write(
        JSON.stringify({
          error: "Unauthorized: Missing X-Access-Token header",
        })
      );
      responseStream.end();
      return;
    }

    console.log("Access token received, length:", accessToken.length);

    // Start streaming response
    responseStream = awslambda.HttpResponseStream.from(
      responseStream,
      metadata
    );

    // Stream from AgentCore
    await streamFromAgentCore(accessToken, prompt.trim(), responseStream);

    responseStream.end();
  } catch (error) {
    console.error("Lambda error:", error);

    // Try to send error if stream hasn't started
    try {
      metadata.statusCode = 500;
      metadata.headers["Content-Type"] = "text/event-stream";
      responseStream = awslambda.HttpResponseStream.from(
        responseStream,
        metadata
      );
      responseStream.write(
        `data: ${JSON.stringify({ error: error.message })}\n\n`
      );
      responseStream.end();
    } catch (streamError) {
      console.error("Error writing to stream:", streamError);
    }
  }
});

/**
 * Stream responses from AgentCore to the client in real-time
 * @param {string} accessToken - Cognito access token
 * @param {string} prompt - User prompt
 * @param {WritableStream} responseStream - Lambda response stream
 */
async function streamFromAgentCore(accessToken, prompt, responseStream) {
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

  // Stream chunks from AgentCore to client in real-time
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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

        console.log("Streaming line:", line);

        // Forward SSE data directly to client
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();

          if (data === "[DONE]") {
            console.log("Stream completed");
            responseStream.write(`data: [DONE]\n\n`);
            break;
          }

          try {
            const parsed = JSON.parse(data);

            // Extract text content if available
            let textContent = "";
            if (parsed.event?.contentBlockDelta?.delta?.text) {
              textContent = parsed.event.contentBlockDelta.delta.text;
            } else if (parsed.text) {
              textContent = parsed.text;
            }

            // Stream text content to client
            if (textContent) {
              responseStream.write(
                `data: ${JSON.stringify({ text: textContent })}\n\n`
              );
            }

            // Also stream errors if any
            if (parsed.error) {
              responseStream.write(`data: ${JSON.stringify(parsed)}\n\n`);
            }
          } catch (parseError) {
            console.error("JSON parse error:", parseError, "for data:", data);
            // Forward unparseable data as-is
            responseStream.write(`data: ${data}\n\n`);
          }
        }
      }
    }

    // Send completion marker
    responseStream.write(`data: [DONE]\n\n`);
  } finally {
    reader.releaseLock();
  }
}
