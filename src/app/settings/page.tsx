import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import Settings from "@/components/Settings";
import { currentUser, founderStats, isLocalMode, listApiTokens, quotaFor, storageUsed } from "@/lib/auth";
import { config } from "@/lib/config";
import { baseUrl } from "@/lib/url";

export const metadata = { title: "Settings · Recap" };

export default function SettingsPage() {
  return (
    <Suspense>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  await connection();
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings");
  const account = {
    cloud: config.cloud,
    used: storageUsed(user.id),
    quota: quotaFor(user),
    founderLimit: config.founderLimit,
    foundersLeft: config.cloud ? founderStats().left : 0,
    price: config.paidPriceLabel,
  };
  return <Settings account={account} user={user} tokens={listApiTokens(user.id)} server={await baseUrl()} signupOpen={config.allowSignup} local={isLocalMode() ? { dataDir: config.dataDir, model: config.whisperModel } : null} />;
}
