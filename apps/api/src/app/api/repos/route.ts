import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { CreateRepoSchema } from "@task-manager/shared";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { corsPreflight, json, requireAuth } from "@/lib/http";
import { mapRepo } from "@/lib/mappers";
import { memoryDb, useMemoryDb } from "@/lib/memory";

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  if (useMemoryDb()) {
    return json({ repos: memoryDb.listRepos() });
  }

  const db = getDb();
  const rows = await db.select().from(repos).orderBy(asc(repos.name));
  return json({ repos: rows.map(mapRepo) });
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = CreateRepoSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  if (useMemoryDb()) {
    return json({ repo: memoryDb.upsertRepo(parsed.data) }, 201);
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(repos)
    .where(eq(repos.path, parsed.data.path))
    .limit(1);

  if (existing.length > 0) {
    const [row] = await db
      .update(repos)
      .set({
        name: parsed.data.name,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(repos.id, existing[0].id))
      .returning();
    return json({ repo: mapRepo(row) });
  }

  const [row] = await db
    .insert(repos)
    .values({
      name: parsed.data.name,
      path: parsed.data.path,
      lastUsedAt: new Date(),
    })
    .returning();

  return json({ repo: mapRepo(row) }, 201);
}
