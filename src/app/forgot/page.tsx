import { ForgotForm } from "@/components/PasswordForms";

export const metadata = { title: "Reset password · Recap" };

export default function ForgotPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-lg font-medium">reset your password</h1>
      <ForgotForm />
    </div>
  );
}
