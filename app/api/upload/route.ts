import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
];

/**
 * Token-vending endpoint for browser-direct uploads to Vercel Blob.
 *
 * The browser calls `upload()` from `@vercel/blob/client`, which talks to this
 * route to (a) get a short-lived signed token, then (b) PUTs the file straight
 * to Vercel Blob. This bypasses Vercel's serverless function body limit
 * (~4.5 MB) so we can ingest the full image (≤ 15 MB) and video (≤ 100 MB)
 * sizes promised in the UI.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "BLOB_READ_WRITE_TOKEN is not configured. Attach a Vercel Blob store to this project.",
      },
      { status: 500 },
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayloadStr) => {
        let kind: "image" | "video" = "image";
        try {
          if (clientPayloadStr) {
            const cp = JSON.parse(clientPayloadStr) as { kind?: string };
            if (cp.kind === "video") kind = "video";
          }
        } catch {
          // ignore — default to image
        }
        const allowedContentTypes =
          kind === "video" ? VIDEO_TYPES : IMAGE_TYPES;
        const maximumSizeInBytes =
          kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        return {
          allowedContentTypes,
          maximumSizeInBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ kind, pathname }),
        };
      },
      onUploadCompleted: async () => {
        // No persistence — the client will pass the URL straight to /api/generate.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 400 },
    );
  }
}
