import { useState, useCallback } from "react";
import { useAuth } from "./useAuth";

/**
 * SSEチャット機能のオプション設定
 */
interface SSEChatOptions {
  maxRetries?: number; // 最大再試行回数
  retryDelay?: number; // 再試行間隔（ミリ秒）
}

// ストリーミング関連の関数は削除（API Gatewayでは使用しない）
// const extractDataFromLine = (line: string): string | null => {
//   if (line.startsWith("data: ")) {
//     return line.slice(6).trim();
//   }
//   return null;
// };

// const extractMessageContent = (
//   parsed: Record<string, unknown>
// ): string | null => {
//   // エラーチェック
//   if (parsed.error && typeof parsed.error === "string") {
//     throw new Error(parsed.error);
//   }

//   if (
//     parsed.event &&
//     typeof parsed.event === "object" &&
//     parsed.event !== null
//   ) {
//     const event = parsed.event as {
//       contentBlockDelta?: { delta?: { text?: string } };
//     };
//     if (event.contentBlockDelta?.delta?.text) {
//       return event.contentBlockDelta.delta.text;
//     }
//   }

//   return null;
// };

/**
 * SSE（Server-Sent Events）を使用したチャット機能のカスタムフック
 *
 * @param options 設定オプション
 * @returns チャット機能のstate と関数
 */
export function useSSEChat(options: SSEChatOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  // State管理
  const [messages, setMessages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 認証管理
  const { getAuthTokens } = useAuth();

  /**
   * メッセージを送信してAIからの応答を受信する
   * @param prompt ユーザーからの入力プロンプト
   * @param retryCount 現在の再試行回数（内部使用）
   */
  const sendMessage = useCallback(
    async (prompt: string, retryCount = 0): Promise<void> => {
      if (!prompt?.trim()) return;

      setIsLoading(true);
      setError(null);

      // 認証トークンを取得
      const { idToken, accessToken } = await getAuthTokens();
      if (!idToken || !accessToken) {
        setError("認証トークンが取得できません");
        setIsLoading(false);
        return;
      }

      try {
        // API Gateway endpointにリクエストを送信（認証はAPI Gatewayで処理）
        const response = await fetch(
          "https://ip5fpmmfh8.execute-api.ap-northeast-1.amazonaws.com/dev/chat",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: idToken, // Send just the JWT token for Cognito authorizer
            },
            body: JSON.stringify({ prompt }),
          }
        );

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(
            errorData.error || `HTTP ${response.status}: ${response.statusText}`
          );
        }

        const data = await response.json();

        // 新しいメッセージスロットを追加
        setMessages((prev) => [...prev, ""]);

        // 完全なレスポンスを処理（ストリーミングではない）
        const finalMessage = data.text || "";
        setMessages((prev) => [...prev.slice(0, -1), finalMessage]);
      } catch (fetchError) {
        // 自動再試行（指数バックオフ）
        if (retryCount < maxRetries) {
          setTimeout(() => {
            sendMessage(prompt, retryCount + 1);
          }, retryDelay * Math.pow(2, retryCount));
        } else {
          const errorMessage =
            fetchError instanceof Error ? fetchError.message : "Unknown error";
          setError(`通信エラー: ${errorMessage}`);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [getAuthTokens, maxRetries, retryDelay]
  );

  /**
   * メッセージ履歴をクリアする
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages, // メッセージ履歴
    isLoading, // 送信中フラグ
    error, // エラーメッセージ
    sendMessage, // メッセージ送信関数
    clearMessages, // 履歴クリア関数
  };
}
