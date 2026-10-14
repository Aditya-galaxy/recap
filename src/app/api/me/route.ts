import { currentUser, unauthorized } from "@/lib/auth";

/** Lets the desktop apps verify their server URL + token ("connected as …"). */
export async function GET() {
  const user = await currentUser();
  return user ? Response.json(user) : unauthorized();
}
