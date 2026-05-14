import { del } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN is not configured." },
        { status: 500 },
      );
    }
    const { urls } = (await request.json()) as { urls?: string[] };
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ ok: true });
    }
    await del(urls);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Delete failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
