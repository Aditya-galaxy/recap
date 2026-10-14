import { currentUser, isLocalMode, unauthorized } from "@/lib/auth";
import { linkStatus, startLink, unlink } from "@/lib/cloud-link";

// Desktop app only: the connection between this local library and a Recap Cloud account.

async function guard() {
  if (!isLocalMode()) return Response.json({ error: "not found" }, { status: 404 });
  return (await currentUser()) ? null : unauthorized();
}

const fail = (err: unknown) => Response.json({ state: "disconnected", error: (err as Error).message }, { status: 502 });

export async function GET() {
  return (await guard()) ?? linkStatus().then((s) => Response.json(s), fail);
}

/** Start connecting: returns the code to approve in the browser. */
export async function POST() {
  return (await guard()) ?? startLink().then((s) => Response.json(s), fail);
}

export async function DELETE() {
  const denied = await guard();
  if (denied) return denied;
  await unlink();
  return new Response(null, { status: 204 });
}
