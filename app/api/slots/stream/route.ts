import { getConnection } from "@/lib/observatory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const write = (payload: Record<string, unknown>) => {
        if (!closed) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        }
      };

      try {
        const connection = getConnection();
        write({
          level: "info",
          message: "Slot stream connected",
          timestamp: new Date().toISOString(),
        });

        while (!closed) {
          const slot = await connection.getSlot("confirmed");
          write({
            level: "slot",
            message: `confirmed slot ${slot}`,
            slot,
            timestamp: new Date().toISOString(),
          });
          await new Promise((resolve) => setTimeout(resolve, 1800));
        }
      } catch (error) {
        write({
          level: "error",
          message:
            error instanceof Error ? error.message : "Slot stream failed",
          timestamp: new Date().toISOString(),
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
    cancel() {
      closed = true;
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
