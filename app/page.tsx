"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useRef, useState, useEffect } from "react";

async function readJsonOrError(res: Response): Promise<{
  ok: boolean;
  data: Record<string, unknown> | null;
  errorText: string | null;
}> {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return { ok: res.ok, data, errorText: null };
  } catch {
    return {
      ok: res.ok,
      data: null,
      errorText:
        text.slice(0, 200) ||
        `Server returned HTTP ${res.status} with no body.`,
    };
  }
}

type ModelKey = "kling-2.6-std" | "kling-2.6-pro" | "kling-3-std" | "kling-3-pro";

const MODELS: Record<
  ModelKey,
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

const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];

const ORIENTATIONS = [
  { value: "video", label: "Video (default)" },
  { value: "image", label: "Image" },
];

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|m3u8)/i;
const VIDEO_HINT_RE = /video|output|result|download/i;

function findVideoUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const direct = [
    d.video_url,
    d.output_url,
    d.result_url,
    d.url,
    d.download_url,
    Array.isArray(d.output) ? d.output[0] : undefined,
    Array.isArray(d.outputs) ? d.outputs[0] : undefined,
    (d.data as Record<string, unknown> | undefined)?.output &&
      Array.isArray((d.data as Record<string, unknown>).output)
      ? ((d.data as Record<string, unknown>).output as unknown[])[0]
      : undefined,
    (d.result as Record<string, unknown> | undefined)?.output &&
      Array.isArray((d.result as Record<string, unknown>).output)
      ? ((d.result as Record<string, unknown>).output as unknown[])[0]
      : undefined,
    (d.data as Record<string, unknown> | undefined)?.video_url,
    (d.result as Record<string, unknown> | undefined)?.video_url,
    (d.data as Record<string, unknown> | undefined)?.url,
    (d.result as Record<string, unknown> | undefined)?.url,
  ];
  for (const v of direct) {
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return deepScan(data, 0);
}

function deepScan(value: unknown, depth: number): string | null {
  if (depth > 6) return null;
  if (typeof value === "string") {
    try {
      const u = new URL(value);
      if (VIDEO_EXT_RE.test(u.pathname) || VIDEO_HINT_RE.test(u.pathname))
        return value;
    } catch {
      // ignore
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = deepScan(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const priority = [
      "video_url",
      "output_url",
      "result_url",
      "url",
      "download_url",
    ];
    const obj = value as Record<string, unknown>;
    for (const k of priority) {
      if (obj[k]) {
        const r = deepScan(obj[k], depth + 1);
        if (r) return r;
      }
    }
    for (const k of Object.keys(obj)) {
      if (priority.includes(k)) continue;
      const r = deepScan(obj[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

type Status = "idle" | "uploading" | "generating" | "polling" | "done" | "error";

export default function Page() {
  const [apiKey, setApiKey] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [model, setModel] = useState<ModelKey>(MODEL_KEYS[0]);
  const [prompt, setPrompt] = useState("");
  const [orientation, setOrientation] = useState("video");
  const [cfgScale, setCfgScale] = useState(0.5);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [showRaw, setShowRaw] = useState(false);

  const uploadedImageUrl = useRef<string | null>(null);
  const uploadedVideoUrl = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCount = useRef(0);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const cleanupBlobs = useCallback(async () => {
    const urls = [
      uploadedImageUrl.current,
      uploadedVideoUrl.current,
    ].filter(Boolean) as string[];
    if (urls.length === 0) return;
    uploadedImageUrl.current = null;
    uploadedVideoUrl.current = null;
    try {
      await fetch("/api/delete-blob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
    } catch {
      // ignore
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const stopTimeout = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (taskId: string, modelKey: ModelKey, key: string) => {
      stopPolling();
      pollCount.current = 0;
      pollTimeoutRef.current = setTimeout(async () => {
        stopPolling();
        await cleanupBlobs();
        setStatus("error");
        setErrorMessage(
          "Task timed out after 20 minutes. Reference files have been cleaned up.",
        );
        setProgress(0);
      }, 20 * 60 * 1000);

      pollIntervalRef.current = setInterval(async () => {
        try {
          pollCount.current += 1;
          const pct = Math.min(65 + 2 * pollCount.current, 95);
          setProgress(pct);
          setProgressLabel(`Polling result... ${pct}%`);
          const res = await fetch("/api/task-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: key, model: modelKey, taskId }),
          });
          const parsed = await readJsonOrError(res);
          const data = parsed.data ?? {};
          if (parsed.data) setRawResponse(parsed.data);
          if (!parsed.ok) {
            stopPolling();
            stopTimeout();
            await cleanupBlobs();
            setStatus("error");
            setErrorMessage(
              (data.error as string | undefined) ||
                parsed.errorText ||
                "Status check failed.",
            );
            setProgress(0);
            return;
          }
          const url = findVideoUrl(data);
          if (url) {
            stopPolling();
            stopTimeout();
            await cleanupBlobs();
            setResultUrl(url);
            setStatus("done");
            setProgress(100);
            setProgressLabel("Done! 100%");
            return;
          }
          const pickStatus = (v: unknown): string | undefined => {
            if (v && typeof v === "object") {
              const s = (v as Record<string, unknown>).status;
              if (typeof s === "string") return s;
            }
            return undefined;
          };
          const taskStatus = (
            pickStatus(data) ??
            pickStatus(data.data) ??
            pickStatus(data.result) ??
            pickStatus(data.task) ??
            ""
          ).toLowerCase();
          if (["failed", "error", "cancelled"].includes(taskStatus)) {
            stopPolling();
            stopTimeout();
            await cleanupBlobs();
            setStatus("error");
            setErrorMessage(
              `Task ${taskStatus}. Check raw response for details.`,
            );
            setProgress(0);
          }
        } catch (err) {
          stopPolling();
          stopTimeout();
          await cleanupBlobs();
          setStatus("error");
          setErrorMessage(
            err instanceof Error ? err.message : "Polling error.",
          );
          setProgress(0);
        }
      }, 5000);
    },
    [cleanupBlobs, stopPolling, stopTimeout],
  );

  const handleGenerate = async () => {
    setErrorMessage("");
    setResultUrl(null);
    setRawResponse(null);
    setShowRaw(false);
    uploadedImageUrl.current = null;
    uploadedVideoUrl.current = null;

    if (!apiKey.trim()) {
      setErrorMessage("API key is required.");
      return;
    }
    if (!imageFile) {
      setErrorMessage("Please upload a reference image.");
      return;
    }
    if (!videoFile) {
      setErrorMessage("Please upload a reference video.");
      return;
    }
    if (!model) {
      setErrorMessage("Please select a model.");
      return;
    }

    try {
      setStatus("uploading");
      setProgress(5);
      setProgressLabel("Uploading image... 5%");

      const imgBlob = await upload(imageFile.name, imageFile, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: JSON.stringify({ kind: "image" }),
      });
      uploadedImageUrl.current = imgBlob.url;

      setProgress(30);
      setProgressLabel("Uploading video... 30%");

      const vidBlob = await upload(videoFile.name, videoFile, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: JSON.stringify({ kind: "video" }),
      });
      uploadedVideoUrl.current = vidBlob.url;

      setProgress(55);
      setProgressLabel("Sending to Magnific... 55%");
      setStatus("generating");

      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          model,
          image_url: imgBlob.url,
          video_url: vidBlob.url,
          prompt,
          character_orientation: orientation,
          cfg_scale: cfgScale,
        }),
      });
      const genParsed = await readJsonOrError(genRes);
      if (genParsed.data) setRawResponse(genParsed.data);
      if (!genParsed.ok) {
        const errMsg =
          (genParsed.data?.error as string | undefined) ||
          genParsed.errorText ||
          "Generation request failed.";
        throw new Error(errMsg);
      }
      const genData = genParsed.data ?? {};
      if (!genData.taskId)
        throw new Error("No taskId returned. Check raw response.");

      setProgress(65);
      setProgressLabel("Task created, waiting for result... 65%");
      setStatus("polling");
      startPolling(
        genData.taskId as string,
        ((genData.model as ModelKey | undefined) || model) as ModelKey,
        apiKey,
      );
    } catch (err) {
      stopPolling();
      stopTimeout();
      await cleanupBlobs();
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
      setProgress(0);
    }
  };

  const isProcessing =
    status === "uploading" || status === "generating" || status === "polling";

  return (
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] selection:bg-[#FF5F45]/30 relative overflow-hidden">
      {/* Ambient Background Effects */}
      <div className="fixed top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#FF5F45]/5 blur-[150px] pointer-events-none" />
      <div className="fixed bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-orange-500/5 blur-[150px] pointer-events-none" />
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808005_1px,transparent_1px),linear-gradient(to_bottom,#80808005_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none mask-[radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />

      <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        
        {/* Header Section */}
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 bg-[#FF5F45]/10 text-[#FF5F45] border border-[#FF5F45]/20 rounded-full px-4 py-1.5 text-xs font-semibold mb-6 tracking-wide">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF5F45] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FF5F45]"></span>
            </span>
            AI POWERED
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-zinc-500 mb-3">
            Kling Motion
          </h1>
          <p className="text-[#71717a] max-w-md mx-auto text-sm leading-relaxed">
            Transform static images into dynamic videos using state-of-the-art Kling AI motion control.
          </p>
          <a
            href="https://www.facebook.com/tiarasikamulia"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 text-xs text-[#a1a1aa] hover:text-white transition-colors group"
          >
            <i className="fa-brands fa-facebook-f text-[#FF5F45] group-hover:scale-110 transition-transform"></i>
            <span className="border-b border-dashed border-zinc-700 group-hover:border-zinc-500 transition-colors">Follow facebook</span>
          </a>
        </header>

        <div className="space-y-5">
          {/* API Key Card */}
          <div className="bg-[#18181b]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-5 shadow-2xl shadow-black/20">
            <Label text="API Key" hint="Magnific / Freepik API key — never stored" />
            <div className="relative mt-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-mag-..."
                autoComplete="off"
                className="w-full bg-[#09090b] border border-white/10 focus:border-[#FF5F45]/50 focus:ring-1 focus:ring-[#FF5F45]/20 rounded-xl px-4 py-3.5 text-sm text-[#f4f4f5] placeholder:text-zinc-600 outline-none transition-all font-mono"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </div>
            </div>
          </div>

          {/* Upload Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="bg-[#18181b]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-5 shadow-2xl shadow-black/20">
              <Label text="Reference Image" hint="JPG, PNG, WebP · max 15 MB" />
              <div className="mt-2">
                <DropZone
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  preview={imagePreview}
                  previewType="image"
                  label="Click or drag image here"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setImageFile(f);
                      setImagePreview(URL.createObjectURL(f));
                    }
                  }}
                  inputRef={imageInputRef}
                  fileName={imageFile?.name}
                />
              </div>
            </div>
            
            <div className="bg-[#18181b]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-5 shadow-2xl shadow-black/20">
              <Label text="Reference Video" hint="MP4, MOV, WebM · max 100 MB" />
              <div className="mt-2">
                <DropZone
                  accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
                  preview={videoPreview}
                  previewType="video"
                  label="Click or drag video here"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setVideoFile(f);
                      setVideoPreview(URL.createObjectURL(f));
                    }
                  }}
                  inputRef={videoInputRef}
                  fileName={videoFile?.name}
                />
              </div>
            </div>
          </div>

          {/* Options Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="bg-[#18181b]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-5 shadow-2xl shadow-black/20 space-y-4">
              <Label text="Model" />
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as ModelKey)}
                  className="w-full bg-[#09090b] border border-white/10 focus:border-[#FF5F45]/50 rounded-xl px-4 py-3.5 text-sm text-[#f4f4f5] outline-none appearance-none cursor-pointer transition-all"
                >
                  {MODEL_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {MODELS[k].label}
                    </option>
                  ))}
                </select>
                <Chevron />
              </div>

              <div>
                <Label text="Orientation" />
                <div className="relative mt-2">
                  <select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value)}
                    className="w-full bg-[#09090b] border border-white/10 focus:border-[#FF5F45]/50 rounded-xl px-4 py-3.5 text-sm text-[#f4f4f5] outline-none appearance-none cursor-pointer transition-all"
                  >
                    {ORIENTATIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <Chevron />
                </div>
              </div>
            </div>

            <div className="bg-[#18181b]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-5 shadow-2xl shadow-black/20 space-y-4">
              <Label text="Prompt" hint="Optional motion description" />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. The character walks forward slowly..."
                rows={3}
                className="w-full bg-[#09090b] border border-white/10 focus:border-[#FF5F45]/50 focus:ring-1 focus:ring-[#FF5F45]/20 rounded-xl px-4 py-3.5 text-sm text-[#f4f4f5] placeholder:text-zinc-600 outline-none resize-none transition-all"
               />Animate the woman from the image so she performs the same dance movements as in the video, while preserving the original scene and environment.

              <div>
                <div className="flex items-baseline justify-between">
                  <Label text="CFG Scale" />
                  <span className="text-xs font-mono text-[#FF5F45]">{cfgScale.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[10px] text-zinc-600 font-medium">FREE</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={cfgScale}
                    onChange={(e) => setCfgScale(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 rounded-full cursor-pointer accent-[#FF5F45] bg-zinc-800"
                  />
                  <span className="text-[10px] text-zinc-600 font-medium">STRICT</span>
                </div>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl px-5 py-4 text-red-400 text-sm flex items-start gap-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-shrink-0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {errorMessage}
            </div>
          )}

          {/* Processing State */}
          {isProcessing && (
            <div className="bg-[#18181b]/80 backdrop-blur-sm border border-[#FF5F45]/20 rounded-2xl p-5 shadow-2xl shadow-[#FF5F45]/5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF5F45] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FF5F45]"></span>
                </div>
                <span className="text-sm text-zinc-300 font-medium">
                  {progressLabel.replace(/\s*\d+%$/, "")}
                </span>
                <span className="ml-auto text-xs font-mono text-zinc-500">{progress}%</span>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#FF5F45] to-orange-400 rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Success State */}
          {status === "done" && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 flex-shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-300">Video ready!</p>
                <p className="text-xs text-zinc-500">Scroll down to preview and download.</p>
              </div>
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={isProcessing}
            className="w-full py-4 rounded-2xl font-bold text-sm tracking-wide transition-all bg-gradient-to-r from-[#FF5F45] to-orange-500 hover:shadow-xl hover:shadow-[#FF5F45]/20 hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none text-white flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Processing...
              </>
            ) : (
              "Generate Motion Video"
            )}
          </button>

          {/* Result Panel */}
          {resultUrl && <ResultPanel url={resultUrl} />}

          {/* Raw Response Panel */}
          {rawResponse !== null && (
            <div className="bg-[#18181b]/80 backdrop-blur-sm border border-white/5 rounded-2xl overflow-hidden shadow-2xl shadow-black/20">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-medium"
              >
                <span className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  Raw API Response
                </span>
                <span className="text-zinc-600">{showRaw ? "▲ Hide" : "▼ Show"}</span>
              </button>
              {showRaw && (
                <pre className="px-5 pb-5 text-xs text-zinc-600 overflow-x-auto whitespace-pre-wrap break-all max-h-64 border-t border-white/5 pt-4 font-mono">
                  {JSON.stringify(rawResponse, null, 2)}
                </pre>
              )}
            </div>
          )}
          
          <div className="pb-10" />
        </div>
      </div>
    </main>
  );
}

// --- Reusable UI Components ---

function Label({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
        {text}
      </span>
      {hint && <span className="text-[11px] text-zinc-600">{hint}</span>}
    </div>
  );
}

function Chevron() {
  return (
    <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>
  );
}

// --- DROPZONE YANG SUDAH DIPERBAIKI 100% WORK ---
function DropZone({
  accept,
  preview,
  previewType,
  label,
  onChange,
  inputRef,
  fileName,
}: {
  accept: string;
  preview: string | null;
  previewType: "image" | "video";
  label: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  fileName?: string;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Gunakan useEffect untuk menangkap event native secara langsung di DOM
  // Ini menjamin browser tidak membuka file tersebut di tab baru
  useEffect(() => {
    const el = dropZoneRef.current;
    if (!el) return;

    const handleDragOver = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    };

    const handleDragLeave = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    };

    const handleDrop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const dragEvent = e as DragEvent;
      const files = dragEvent.dataTransfer?.files;
      if (files && files.length > 0) {
        // Karena onChange membutuhkan React.ChangeEvent, kita buat objek tiruan (mock)
        // yang berisi properti `files` agar bisa dibaca oleh fungsi onChange
        const mockEvent = {
          target: { files },
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        
        onChange(mockEvent);
      }
    };

    // Tambahkan listener dengan { capture: true } agar lebih diprioritaskan
    el.addEventListener("dragover", handleDragOver, true);
    el.addEventListener("dragleave", handleDragLeave, true);
    el.addEventListener("drop", handleDrop, true);

    // Cleanup saat component unmount
    return () => {
      el.removeEventListener("dragover", handleDragOver, true);
      el.removeEventListener("dragleave", handleDragLeave, true);
      el.removeEventListener("drop", handleDrop, true);
    };
  }, [onChange]);

  return (
    <div
      ref={dropZoneRef}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); }} // Backup handler React
      className={`relative group cursor-pointer rounded-xl border-2 border-dashed transition-all duration-300 overflow-hidden bg-[#09090b] ${
        isDragOver 
          ? "border-[#FF5F45] bg-[#FF5F45]/10 scale-[1.02]" 
          : "border-zinc-800 hover:border-zinc-600 hover:bg-white/[0.02]"
      }`}
      style={{ minHeight: 160 }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onChange}
        className="hidden"
      />
      {preview ? (
        <div className="relative w-full h-full" style={{ minHeight: 160 }}>
          {previewType === "image" ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={preview}
              alt="Preview"
              className="w-full h-full object-cover"
              style={{ maxHeight: 200 }}
            />
          ) : (
            <video
              src={preview}
              className="w-full"
              style={{ maxHeight: 200 }}
              muted
              playsInline
            />
          )}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
            <span className="text-xs text-[#FF5F45] font-bold bg-black/50 px-3 py-1.5 rounded-lg border border-[#FF5F45]/30">Change</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full py-10 gap-3 text-zinc-600 group-hover:text-zinc-400 transition-colors">
          <div className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors ${isDragOver ? "bg-[#FF5F45]/20 border-[#FF5F45]/40 text-[#FF5F45]" : "bg-zinc-900 border-zinc-800 group-hover:border-zinc-600"}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="text-xs text-center px-2">
            {isDragOver ? "Drop file here" : label}
          </p>
        </div>
      )}
      {fileName && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
          <p className="text-[11px] text-zinc-400 truncate font-mono">{fileName}</p>
        </div>
      )}
    </div>
  );
}

function ResultPanel({ url }: { url: string }) {
  const [tab, setTab] = useState<"preview" | "download">("preview");
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = url.split("?")[0].split(".").pop() || "mp4";
      const name = `kling-motion-${Date.now()}.${ext}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-[#18181b]/80 backdrop-blur-sm border border-white/5 rounded-2xl overflow-hidden shadow-2xl shadow-black/20 mt-5">
      <div className="flex border-b border-white/5">
        {(["preview", "download"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest transition-all duration-200 ${
              tab === t
                ? "text-[#FF5F45] bg-[#FF5F45]/5 border-b-2 border-[#FF5F45]"
                : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.02]"
            }`}
          >
            {t === "preview" ? "Preview" : "Download Media"}
          </button>
        ))}
      </div>
      <div className="p-5">
        {tab === "preview" && (
          <video
            src={url}
            controls
            playsInline
            className="w-full rounded-xl bg-black shadow-xl"
          />
        )}
        {tab === "download" && (
          <div className="flex flex-col items-center gap-5 py-8">
            <div className="w-16 h-16 rounded-2xl bg-[#FF5F45]/10 border border-[#FF5F45]/20 flex items-center justify-center text-[#FF5F45]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white mb-1">
                Download Result Video
              </p>
              <p className="text-xs text-zinc-500">
                Video will be saved to your device
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              <button
                onClick={download}
                disabled={downloading}
                className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-[#FF5F45] to-orange-500 hover:shadow-lg hover:shadow-[#FF5F45]/20 disabled:opacity-50 text-white transition-all flex items-center justify-center gap-2"
              >
                {downloading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Downloading...</span>
                  </>
                ) : (
                  "Download Video"
                )}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 rounded-xl font-medium text-xs text-center text-zinc-500 hover:text-white border border-zinc-800 hover:border-zinc-600 transition-all"
              >
                Open in New Tab ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
