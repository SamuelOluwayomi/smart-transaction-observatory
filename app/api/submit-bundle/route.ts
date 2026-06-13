import { NextResponse } from "next/server";
import { submitBundle } from "@/lib/observatory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await submitBundle(undefined, body));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to submit bundle",
      },
      { status: 500 },
    );
  }
}
