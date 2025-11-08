import { CognitoJwtVerifier } from "aws-jwt-verify";
import { logError } from "./error-utils";
import outputs from "@/src/amplifyconfiguration.json";

// JWT検証器を作成（シングルトンパターン）
// amplifyconfiguration.jsonから設定を取得（Gen 1形式）
const verifier = CognitoJwtVerifier.create({
  userPoolId: outputs.aws_user_pools_id, // Gen 1: aws_user_pools_id
  tokenUse: "id", // IDトークンを検証
  clientId: outputs.aws_user_pools_web_client_id, // Gen 1: aws_user_pools_web_client_id
});

// JWTトークンを検証する関数
export async function verifyJWT(token: string): Promise<boolean> {
  try {
    // トークンの署名、有効期限、発行者などを検証
    const payload = await verifier.verify(token);
    console.log("JWT検証成功:", payload.sub); // ユーザーID
    return true;
  } catch (error) {
    logError("JWT検証", error);
    return false;
  }
}
