import { submitBundle, type SubmitLog } from "@/lib/observatory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeEvent(log: SubmitLog) {
  return `data: ${JSON.stringify({
    ...log,
    timestamp: new Date().toISOString(),
  })}\n\n`;
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const body = await request.json().catch(() => ({}));

  const stream = new ReadableStream({
    async start(controller) {
      const write = (log: SubmitLog) => {
        controller.enqueue(encoder.encode(encodeEvent(log)));
      };

      try {
        const run = await submitBundle(write, body);
        write({
          level: "success",
          message: "Dashboard execution complete",
          data: {
            runNumber: run.run_number,
            status: run.status,
            bundleId: run.bundle_id,
            signature: run.signature,
          },
        });
      } catch (error) {
        write({
          level: "error",
          message:
            error instanceof Error
              ? error.message
              : "Dashboard execution failed",
        });
      } finally {
        controller.enqueue(
          encoder.encode(
            encodeEvent({
              level: "info",
              message: "[stream:end]",
            }),
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
