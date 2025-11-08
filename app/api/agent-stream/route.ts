import { NextRequest } from "next/server";
import { verifyJWT } from "@/lib/auth-utils";
import { getErrorMessage, logError } from "@/lib/error-utils";

// AWS Bedrock AgentCoreのベースURL
const BEDROCK_AGENT_CORE_ENDPOINT_URL =
  "https://bedrock-agentcore.ap-northeast-1.amazonaws.com";

/**
 * リクエストからIDトークンとアクセストークンを抽出・検証する
 * @param request Next.jsリクエストオブジェクト
 * @returns 検証済みのIDトークンとアクセストークン
 */
async function authenticate(
  request: NextRequest
): Promise<{ idToken: string; accessToken: string }> {
  // AuthorizationヘッダーからIDトークンを取得
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing ID token");
  }

  // IDトークンを抽出してJWT検証
  const idToken = authHeader.substring(7);
  const isValid = await verifyJWT(idToken);
  if (!isValid) {
    throw new Error("Invalid ID token");
  }

  // カスタムヘッダーからアクセストークンを取得
  const accessToken = request.headers.get("x-access-token");
  if (!accessToken) {
    throw new Error("Missing access token");
  }

  return { idToken, accessToken };
}

/**
 * AWS Bedrock AgentCoreとの通信を処理し、レスポンスをSSE形式でストリーミングする
 * @param accessToken AWS Cognitoアクセストークン
 * @param prompt ユーザーからの入力プロンプト
 * @param controller ReadableStreamのコントローラー
 */
async function streamFromAgentCore(
  accessToken: string,
  prompt: string,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();

  try {
    // 環境変数からエージェントARNを取得
    const agentArn = process.env.AGENT_CORE_ARN || "";
    const fullUrl = `${BEDROCK_AGENT_CORE_ENDPOINT_URL}/runtimes/${encodeURIComponent(
      agentArn
    )}/invocations`;

    console.log("Calling AgentCore:", fullUrl);

    // AgentCoreにPOSTリクエストを送信 (Cognito認証を使用 - アクセストークンを使用)
    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`, // Cognitoアクセストークンを使用
      },
      body: JSON.stringify({ prompt: prompt.trim() }),
    });

    console.log("AgentCore response status:", response.status);

    // レスポンスステータスをチェック
    if (!response.ok) {
      const errorText = await response.text();
      console.error("AgentCore error:", errorText);
      throw new Error(
        `AgentCore returned ${response.status}: ${response.statusText} - ${errorText}`
      );
    }

    // レスポンスボディの存在確認
    if (!response.body) {
      throw new Error("No response body from AgentCore");
    }

    // ストリーミングレスポンスの処理開始
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        // チャンクを読み取り
        const { done, value } = await reader.read();
        if (done) break;

        // バイナリデータをテキストに変換してバッファに追加
        buffer += decoder.decode(value, { stream: true });

        // 改行区切りでデータを処理
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) continue;

          console.log("Received line:", line);

          // SSE形式（Server-Sent Events）の処理
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              console.log("Stream completed");
              return; // ストリーム終了シグナル
            }

            try {
              const parsed = JSON.parse(data);
              console.log("Parsed data:", parsed);

              // AgentCoreのレスポンス形式に合わせて調整
              let textContent = "";
              if (parsed.event?.contentBlockDelta?.delta?.text) {
                textContent = parsed.event.contentBlockDelta.delta.text;
              } else if (parsed.text) {
                textContent = parsed.text;
              } else if (typeof parsed === "string") {
                textContent = parsed;
              }

              if (textContent) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      event: {
                        contentBlockDelta: {
                          delta: { text: textContent },
                        },
                      },
                    })}\n\n`
                  )
                );
              }
            } catch (parseError) {
              console.error("JSON parse error:", parseError, "for data:", data);
              // JSONパースエラーは無視して続行
            }
          } else {
            // JSON形式の直接レスポンスの処理
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
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      event: {
                        contentBlockDelta: {
                          delta: { text: textContent },
                        },
                      },
                    })}\n\n`
                  )
                );
              }
            } catch (parseError) {
              console.error(
                "Direct JSON parse error:",
                parseError,
                "for line:",
                line
              );
              // JSONパースエラーは無視して続行
            }
          }
        }
      }

      // バッファに残った最後のデータを処理
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
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  event: {
                    contentBlockDelta: {
                      delta: { text: textContent },
                    },
                  },
                })}\n\n`
              )
            );
          }
        } catch (parseError) {
          console.error(
            "Buffer parse error:",
            parseError,
            "for buffer:",
            buffer
          );
          // JSONパースエラーは無視
        }
      }
    } finally {
      // リソースを確実に解放
      reader.releaseLock();
    }

    // ストリーム終了シグナル
    controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
  } catch (error) {
    console.error("AgentCore streaming error:", error);
    // エラーをSSE形式で送信
    const errorMessage = getErrorMessage(error);
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
    );
  }
}

/**
 * SSE（Server-Sent Events）を使用してAWS Bedrock AgentCoreとの通信を処理するAPIエンドポイント
 *
 * フロー:
 * 1. IDトークンとアクセストークンを検証
 * 2. プロンプトを受け取り
 * 3. AgentCoreにリクエストを送信
 * 4. レスポンスをリアルタイムでストリーミング
 *
 * @param request Next.jsリクエストオブジェクト
 * @returns SSEストリームレスポンス
 */
export async function POST(request: NextRequest) {
  try {
    // ユーザー認証の実行
    const { idToken, accessToken } = await authenticate(request);

    // リクエストボディからプロンプトを取得
    const { prompt } = await request.json();
    if (!prompt?.trim()) {
      return new Response("Bad Request: Empty prompt", { status: 400 });
    }

    // SSE（Server-Sent Events）ストリームを作成
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // AgentCoreとの通信を開始 (アクセストークンを使用)
          await streamFromAgentCore(accessToken, prompt, controller);
        } catch (error) {
          // エラーが発生した場合、エラーメッセージをSSE形式で送信
          const encoder = new TextEncoder();
          const errorMessage = getErrorMessage(error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: errorMessage })}\n\n`
            )
          );
        } finally {
          // ストリームを確実に終了
          controller.close();
        }
      },
    });

    // SSE用のHTTPヘッダーを設定してレスポンスを返す
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream", // SSE形式を指定
        "Cache-Control": "no-cache", // キャッシュを無効化
        Connection: "keep-alive", // 接続を維持
        "Access-Control-Allow-Origin": "*", // CORS設定
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Access-Token",
      },
    });
  } catch (error) {
    // 認証関連のエラー処理
    if (
      error instanceof Error &&
      (error.message.includes("Missing") || error.message.includes("Invalid"))
    ) {
      return new Response(`Unauthorized: ${error.message}`, { status: 401 });
    }

    // その他のエラー処理
    logError("SSEエンドポイント", error);
    return new Response(`Internal Server Error: ${getErrorMessage(error)}`, {
      status: 500,
    });
  }
}
