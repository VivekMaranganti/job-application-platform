import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getCurrentUser } from "@/lib/current-user";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <AppShell userEmail={user.email} />;
}
