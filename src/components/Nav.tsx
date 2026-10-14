import Link from "next/link";
import { connection } from "next/server";
import RecordButton from "@/components/RecordButton";
import { currentUser } from "@/lib/auth";

export default async function Nav() {
  await connection();
  const user = await currentUser();
  if (!user) {
    return (
      <nav className="flex items-center gap-2">
        <Link href="/login" className="btn-ghost">sign in</Link>
      </nav>
    );
  }
  return (
    <nav className="flex items-center gap-2">
      <Link href="/" className="btn-ghost hidden sm:inline-flex">library</Link>
      <Link href="/settings" className="btn-ghost" title={user.email}>settings</Link>
      <RecordButton />
    </nav>
  );
}
