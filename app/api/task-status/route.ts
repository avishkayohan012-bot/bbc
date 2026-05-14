import { NextResponse } from "next/server";

export const runtime = "nodejs";

const STATUS_URLS: Record<string, string> = {
  "kling-2.6-std":
    "https://api.magnific.com/v1/ai/image-to-video/kling-v2-6/{taskId}",
  "kling-2.6-pro":
    "https://api.magnific.com/v1/ai/image-to-video/kling-v2-6/{taskId}",
  "kling-3-std":
    "https://api.magnific.com/v1/ai/video/kling-v3-motion-control-std/{taskId}",
  "kling-3-pro":
    "https://api.magnific.com/v1/ai/video/kling-v3-motion-control-pro/{taskId}",
};

type Body = { apiKey?: string; model?: string; taskId?: string };

export async function POST(request: Request) {
  try {
    const { apiKey, model, taskId } = (await request.json()) as Body;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required." },
        { status: 400 },
      );
    }
    if (!model || !STATUS_URLS[model]) {
      return NextResponse.json(
        { error: "Unknown or missing model." },
        { status: 400 },
      );
    }
    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required." },
        { status: 400 },
      );
    }

    const url = STATUS_URLS[model].replace("{taskId}", encodeURIComponent(taskId));
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-freepik-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg =
        (data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : null) ||
        (data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : null) ||
        `Magnific API returned HTTP ${res.status}.`;
      return NextResponse.json(
        { error: errMsg, raw: data },
        { status: res.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Status request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
