import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MODELS: Record<
  string,
  { label: string; createUrl: string; statusUrl: string }
> = {
  "kling-2.6-std": {
    label: "Kling 2.6 Standard",
    createUrl:
      "https://api.magnific.com/v1/ai/video/kling-v2-6-motion-control-std",
    statusUrl:
      "https://api.magnific.com/v1/ai/image-to-video/kling-v2-6/{taskId}",
  },
  "kling-2.6-pro": {
    label: "Kling 2.6 Pro",
    createUrl:
      "https://api.magnific.com/v1/ai/video/kling-v2-6-motion-control-pro",
    statusUrl:
      "https://api.magnific.com/v1/ai/image-to-video/kling-v2-6/{taskId}",
  },
  "kling-3-std": {
    label: "Kling 3 Standard",
    createUrl:
      "https://api.magnific.com/v1/ai/video/kling-v3-motion-control-std",
    statusUrl:
      "https://api.magnific.com/v1/ai/video/kling-v3-motion-control-std/{taskId}",
  },
  "kling-3-pro": {
    label: "Kling 3 Pro",
    createUrl:
      "https://api.magnific.com/v1/ai/video/kling-v3-motion-control-pro",
    statusUrl:
      "https://api.magnific.com/v1/ai/video/kling-v3-motion-control-pro/{taskId}",
  },
};

type Body = {
  apiKey?: string;
  model?: string;
  image_url?: string;
  video_url?: string;
  prompt?: string;
  character_orientation?: string;
  cfg_scale?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const { apiKey, model, image_url, video_url } = body;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required." },
        { status: 400 },
      );
    }
    if (!model || !MODELS[model]) {
      return NextResponse.json(
        { error: "Unknown or missing model." },
        { status: 400 },
      );
    }
    if (!image_url || !video_url) {
      return NextResponse.json(
        { error: "image_url and video_url are required." },
        { status: 400 },
      );
    }

    const payload: Record<string, unknown> = {
      image_url,
      video_url,
      cfg_scale: body.cfg_scale ?? 0.5,
      character_orientation: body.character_orientation ?? "video",
    };
    if (body.prompt && body.prompt.trim()) payload.prompt = body.prompt;

    const res = await fetch(MODELS[model].createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-freepik-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
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
      return NextResponse.json({ error: errMsg, raw: data }, {
        status: res.status,
      });
    }

    const taskId = extractTaskId(data);
    if (!taskId) {
      return NextResponse.json(
        {
          error: "No taskId returned by Magnific.",
          raw: data,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ taskId, model, raw: data });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Generate request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractTaskId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const candidates = [
    d.task_id,
    d.taskId,
    d.id,
    (d.data as Record<string, unknown> | undefined)?.task_id,
    (d.data as Record<string, unknown> | undefined)?.taskId,
    (d.data as Record<string, unknown> | undefined)?.id,
    (d.result as Record<string, unknown> | undefined)?.task_id,
    (d.result as Record<string, unknown> | undefined)?.taskId,
    (d.result as Record<string, unknown> | undefined)?.id,
    (d.task as Record<string, unknown> | undefined)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}
