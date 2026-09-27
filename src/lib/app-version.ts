import { useEffect } from "react";
import { createServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

const getDeployedBuildId = createServerFn({ method: "GET" }).handler(() => __BUILD_ID__);

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// The desktop app loads dexy.site live, so a reload is all it takes to pick
// up a new deploy -- this just tells the user one exists.
export function useUpdateNotice() {
  useEffect(() => {
    let notified = false;

    const check = async () => {
      if (notified) return;
      try {
        const deployed = await getDeployedBuildId();
        if (deployed === __BUILD_ID__) return;
        notified = true;
        toast("Nova versão do Dexy disponível", {
          description: "Reinicie para aplicar a atualização.",
          duration: Infinity,
          action: { label: "Reiniciar", onClick: () => window.location.reload() },
        });
      } catch {
        // Offline or mid-deploy -- try again on the next tick.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    const interval = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
