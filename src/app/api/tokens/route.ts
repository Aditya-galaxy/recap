import { createApiToken, currentUser, listApiTokens, unauthorized } from "@/lib/auth";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  return Response.json(listApiTokens(user.id));
}

/** Returns the plaintext token exactly once. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const b = await req.json().catch(() => ({}));
  return Response.json(createApiToken(user.id, String(b.name ?? "")), { status: 201 });
}
