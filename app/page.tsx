import { redirect } from "next/navigation";

export default function Home() {
  // No landing page yet - the counter starts at login.
  redirect("/login");
}
