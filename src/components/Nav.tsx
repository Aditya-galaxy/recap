import Link from "next/link";
import { connection } from "next/server";
import Import from "@/components/Import";
import RecordButton from "@/components/RecordButton";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";

export default async function Nav() {
  await connection();
  const user = await currentUser();
  if (!user) {
    return (
      <nav className="flex items-center gap-1">
        <Link href="/login" className="btn-ghost">Sign in</Link>
      </nav>
    );
  }
  return (
    <nav className="flex items-center gap-1">
      <Link href="/" className="btn-quiet hidden sm:inline-flex">Library</Link>
      <Link href="/settings" className="btn-quiet" title={user.email}>Settings</Link>
      <Import local={!!config.localToken} />
      <RecordButton />
    </nav>
  );
}
