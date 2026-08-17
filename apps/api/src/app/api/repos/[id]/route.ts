import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { corsPreflight, json, requireAuth } from "@/lib/http";
import { memoryDb, useMemoryDb } from "@/lib/memory";

export async function OPTIONS() {
  return corsPreflight();
}

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  if (useMemoryDb()) {
    if (!memoryDb.deleteRepo(id)) {
      return json({ error: "Not found" }, 404);
    }
    return json({ ok: true });
  }

  const db = getDb();
  const deleted = await db.delete(repos).where(eq(repos.id, id)).returning();
  if (deleted.length === 0) {
    return json({ error: "Not found" }, 404);
  }
  return json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  if (useMemoryDb()) {
    if (!memoryDb.touchRepo(id)) {
      return json({ error: "Not found" }, 404);
    }
    return json({ ok: true });
  }

  const db = getDb();
  const [row] = await db
    .update(repos)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(repos.id, id))
    .returning();
  if (!row) {
    return json({ error: "Not found" }, 404);
  }
  return json({ ok: true });
}
