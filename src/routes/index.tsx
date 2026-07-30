import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session === undefined) return;
    router.navigate({ to: session ? "/app" : "/login" });
  }, [session, router]);

  return null;
}
