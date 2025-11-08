import { NextRequest } from "next/server";
import { verifyJWT } from "@/lib/auth-utils";
import { getErrorMessage, logError } from "@/lib/error-utils";
import { invokeAgentCore, parseAgentCoreStream } from "@/lib/agentcore";

/**
 * リクエストからIDトークンを抽出・検証する
 * @param request Next.jsリクエストオブジェクト
 * @returns 検証済みのIDトークン
 */
async function authenticate(request: NextRequest): Promise<string> {
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

  return idToken;
}

/**
 * AWS Bedrock AgentCoreとの通信を処理し、レスポンスをSSE形式でストリーミングする
 * @param cognitoIdToken Cognito IDトークン
 * @param prompt ユーザーからの入力プロンプト
 * @param controller ReadableStreamのコントローラー
 */
async function streamFromAgentCore(
  cognitoIdToken: string,
  prompt: string,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();

  // 環境変数から設定を取得
  const region = process.env.BEDROCK_AGENT_CORE_REGION || "ap-northeast-1";
  const agentArn = process.env.AGENT_CORE_ARN;
  const accountId = process.env.AWS_ACCOUNT_ID;
  const identityPoolId = process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID;
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;

  if (!agentArn || !accountId || !identityPoolId || !userPoolId) {
    throw new Error("Missing required environment variables");
  }

  // AgentCoreを呼び出してストリームを取得
  const stream = await invokeAgentCore(prompt, {
    region,
    agentArn,
    accountId,
    identityPoolId,
    userPoolId,
    cognitoIdToken,
  });

  // AgentCoreからのストリームをパースしてSSE形式で送信
  try {
    for await (const text of parseAgentCoreStream(stream)) {
      // Send as Server-Sent Events format
      const sseData = `data: ${JSON.stringify({
        event: {
          contentBlockDelta: {
            delta: {
              text,
            },
          },
        },
      })}\n\n`;
      controller.enqueue(encoder.encode(sseData));
    }
  } catch (error) {
    // エラーメッセージをSSE形式で送信
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
    const idToken = await authenticate(request);

    // リクエストボディからプロンプトを取得
    const { prompt } = await request.json();
    if (!prompt?.trim()) {
      return new Response("Bad Request: Empty prompt", { status: 400 });
    }

    // SSE（Server-Sent Events）ストリームを作成
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // AgentCoreとの通信を開始
          await streamFromAgentCore(idToken, prompt, controller);
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
