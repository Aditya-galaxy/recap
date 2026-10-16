import { aiStatus, downloadModel, removeModel } from "@/lib/ai";
import { currentUser, unauthorized } from "@/lib/auth";

/** On-device AI: is it bundled here, and is its model downloaded? */
export async function GET() {
  if (!(await currentUser())) return unauthorized();
  return Response.json(await aiStatus());
}

/** Download the model (once). */
export async function POST() {
  if (!(await currentUser())) return unauthorized();
  const s = await aiStatus();
  if (!s.available) return Response.json({ error: "On-device AI isn't part of this install." }, { status: 404 });
  downloadModel();
  return Response.json(await aiStatus(), { status: 202 });
}

/** Remove the model to free the disk space. */
export async function DELETE() {
  if (!(await currentUser())) return unauthorized();
  await removeModel();
  return Response.json(await aiStatus());
}
