import { NextRequest } from "next/server";
import { corsPreflight, json } from "@/lib/http";
import { useMemoryDb } from "@/lib/memory";

export async function OPTIONS() {
  return corsPreflight();
}

// 健康检查公开：只暴露存活/存储模式，便于前端“测试连接”在无 token 时也能区分网络故障与鉴权失败
export async function GET(_req: NextRequest) {
  return json({
    ok: true,
    memory: useMemoryDb(),
    hasDatabase: Boolean(process.env.DATABASE_URL),
  });
}
