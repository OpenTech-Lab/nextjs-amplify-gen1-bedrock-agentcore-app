import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentity } from "@aws-sdk/types";

/**
 * Configuration for AgentCore invocation
 */
export interface AgentCoreConfig {
  region: string;
  agentArn: string;
  accountId: string;
  identityPoolId: string;
  userPoolId: string;
  cognitoIdToken: string;
}

/**
 * Invoke AWS Bedrock AgentCore with Cognito authentication
 */
export async function invokeAgentCore(
  prompt: string,
  config: AgentCoreConfig
): Promise<ReadableStream<Uint8Array>> {
  const { region, agentArn, accountId, identityPoolId, userPoolId, cognitoIdToken } = config;

  // Get AWS credentials from Cognito Identity Pool using the ID token
  const credentialsProvider = fromCognitoIdentityPool({
    clientConfig: { region },
    identityPoolId,
    logins: {
      [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: cognitoIdToken,
    },
  });

  // Resolve the credentials
  const resolvedCredentials: AwsCredentialIdentity = await credentialsProvider();

  console.log("Resolved credentials:", {
    accessKeyId: resolvedCredentials.accessKeyId.substring(0, 10) + "...",
    hasSecretKey: !!resolvedCredentials.secretAccessKey,
    hasSessionToken: !!resolvedCredentials.sessionToken,
  });

  // Extract runtime name from ARN (format: arn:aws:bedrock-agentcore:region:account:runtime/NAME)
  // Or use the ARN directly if it's already just the name
  let runtimeIdentifier = agentArn;
  if (agentArn.startsWith("arn:")) {
    const arnParts = agentArn.split("/");
    runtimeIdentifier = arnParts[arnParts.length - 1]; // Get the last part (runtime name)
  }

  console.log("Using runtime identifier:", runtimeIdentifier);

  // Build the AgentCore API URL
  const url = new URL(
    `/runtimes/${encodeURIComponent(runtimeIdentifier)}/invocations`,
    `https://bedrock-agentcore.${region}.amazonaws.com`
  );

  // Note: accountID query parameter might not be needed for AgentCore
  // Removing it to see if it fixes the signature issue

  const body = JSON.stringify({ prompt: prompt.trim() });

  console.log("Request body:", body);

  // Sign the request with AWS Signature V4
  const signer = new SignatureV4({
    credentials: resolvedCredentials,
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

  // Convert headers to a plain object for fetch
  const fetchHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(signedRequest.headers)) {
    if (typeof value === 'string') {
      fetchHeaders[key] = value;
    }
  }

  console.log("Calling AgentCore:", {
    url: url.toString(),
    method: signedRequest.method,
    hasAuthHeader: !!fetchHeaders.authorization || !!fetchHeaders.Authorization,
    headerKeys: Object.keys(fetchHeaders),
  });

  console.log("Authorization header preview:",
    (fetchHeaders.authorization || fetchHeaders.Authorization || "").substring(0, 100) + "..."
  );

  // Make the request to AgentCore
  const response = await fetch(url.toString(), {
    method: signedRequest.method,
    headers: fetchHeaders,
    body: typeof signedRequest.body === 'string' ? signedRequest.body : JSON.stringify(signedRequest.body),
  });

  console.log("AgentCore response status:", response.status);

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("AgentCore error:", errorBody);
    throw new Error(`AgentCore error ${response.status}: ${errorBody}`);
  }

  if (!response.body) {
    throw new Error("No response body from AgentCore");
  }

  console.log("AgentCore response body received, starting to stream...");
  return response.body;
}

/**
 * Parse SSE stream from AgentCore and extract text content
 */
export async function* parseAgentCoreStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  console.log("Starting to parse AgentCore stream...");
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      chunkCount++;
      console.log(`Received chunk ${chunkCount}, done: ${done}`);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) continue;

        // Parse SSE format
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;

          try {
            const parsed = JSON.parse(data);
            console.log("Parsed SSE data:", parsed);

            // Extract text from the event structure
            if (parsed.event?.contentBlockDelta?.delta?.text) {
              const text = parsed.event.contentBlockDelta.delta.text;
              console.log("Yielding text:", text);
              yield text;
            } else {
              console.log("No text content in event:", JSON.stringify(parsed));
            }
          } catch (e) {
            // Ignore parse errors
            console.warn("Failed to parse SSE data:", data, e);
          }
        } else {
          // Try parsing as plain JSON
          try {
            const parsed = JSON.parse(line);
            if (parsed.event?.contentBlockDelta?.delta?.text) {
              yield parsed.event.contentBlockDelta.delta.text;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
