// Complete Lambda function code for agentStreamFunction
// After running 'amplify add function', replace the contents of:
// amplify/backend/function/agentStreamFunction/src/index.js
// with this code

const { defaultProvider } = require("@aws-sdk/credential-provider-node");
const { HttpRequest } = require("@smithy/protocol-http");
const { SignatureV4 } = require("@smithy/signature-v4");
const { Sha256 } = require("@aws-crypto/sha256-js");

const credentialsProvider = defaultProvider();

async function invokeAgentCore(prompt) {
  const region = process.env.BEDROCK_AGENT_CORE_REGION || "ap-northeast-1";
  const agentArn = process.env.AGENT_CORE_ARN || "";
  const accountId = process.env.AWS_ACCOUNT_ID || "";

  const agentIdentifier = agentArn || process.env.AGENT_CORE_ENDPOINT || "";
  const url = new URL(
    `/runtimes/${encodeURIComponent(agentIdentifier)}/invocations`,
    `https://bedrock-agentcore.${region}.amazonaws.com`
  );

  if (!agentArn && accountId) {
    url.searchParams.set("accountID", accountId);
  }

  const body = JSON.stringify({ prompt: prompt.trim() });
  const credentials = await credentialsProvider();

  const signer = new SignatureV4({
    credentials,
    region,
    service: "bedrock-agentcore",
    sha256: Sha256,
  });

  const request = new HttpRequest({
    method: "POST",
    protocol: "https:",
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: {
      "Content-Type": "application/json",
      host: url.hostname,
    },
    body,
  });

  const signedRequest = await signer.sign(request);
  const response = await fetch(url.toString(), {
    method: signedRequest.method,
    headers: signedRequest.headers,
    body: signedRequest.body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AgentCore error ${response.status}: ${errorBody}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) continue;

      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        try {
          events.push(JSON.parse(data));
        } catch (e) {
          // Ignore parse errors
        }
      } else {
        try {
          events.push(JSON.parse(line));
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }

  if (buffer.trim()) {
    try {
      events.push(JSON.parse(buffer));
    } catch (e) {
      // Ignore parse errors
    }
  }

  reader.releaseLock();
  return events;
}

exports.handler = async (event) => {
  console.log("Event received:", JSON.stringify(event, null, 2));

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { prompt } = body;

    if (!prompt?.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Empty prompt" }),
      };
    }

    console.log("Invoking AgentCore with prompt:", prompt);
    const events = await invokeAgentCore(prompt);
    console.log("AgentCore returned", events.length, "events");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ events }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
