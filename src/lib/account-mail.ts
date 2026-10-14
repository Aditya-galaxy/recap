import "server-only";
import { issueEmailToken, type User } from "./auth";
import { config } from "./config";
import { sendMail } from "./email";
import { baseUrl } from "./url";

const DAY = 86_400_000;

export async function sendVerification(user: Pick<User, "id" | "email">) {
  const token = issueEmailToken(user.id, "verify", 3 * DAY);
  const link = `${await baseUrl()}/verify?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Confirm your email for Recap",
    text: config.cloud
      ? `Confirm your email to activate your Recap account. Founding spots (free for life) go to the first ${config.founderLimit} confirmed accounts.\n\nThe link works for 3 days. If you didn't sign up, ignore this email.`
      : "Confirm your email to activate your Recap account.\n\nThe link works for 3 days. If you didn't sign up, ignore this email.",
    action: { label: "Confirm email", url: link },
  });
}

export async function sendPasswordReset(user: Pick<User, "id" | "email">) {
  const token = issueEmailToken(user.id, "reset", 60 * 60_000);
  await sendMail({
    to: user.email,
    subject: "Reset your Recap password",
    text: "Someone (hopefully you) asked to reset your Recap password. The link works for 1 hour and can be used once.\n\nIf it wasn't you, ignore this email; your password hasn't changed.",
    action: { label: "Choose a new password", url: `${await baseUrl()}/reset?token=${token}` },
  });
}
