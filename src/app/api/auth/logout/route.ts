import { endSession } from "@/lib/auth";

export async function POST() {
  await endSession();
  return new Response(null, { status: 204 });
}
