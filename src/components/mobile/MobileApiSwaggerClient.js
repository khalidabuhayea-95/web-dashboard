"use client";

import { useEffect } from "react";

export default function MobileApiSwaggerClient() {
  useEffect(() => {
    let isMounted = true;
    let ui = null;

    async function initSwaggerUi() {
      const [{ default: SwaggerUIBundle }, { default: SwaggerUIStandalonePreset }] = await Promise.all([
        import("swagger-ui-dist/swagger-ui-bundle.js"),
        import("swagger-ui-dist/swagger-ui-standalone-preset.js"),
      ]);

      if (!isMounted) return;

      ui = SwaggerUIBundle({
        url: "/api/mobile/openapi",
        dom_id: "#mobile-swagger-ui",
        docExpansion: "list",
        defaultModelsExpandDepth: 2,
        displayRequestDuration: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout",
      });
    }

    initSwaggerUi();

    return () => {
      isMounted = false;
      if (ui && typeof ui.destroy === "function") ui.destroy();
      const root = document.getElementById("mobile-swagger-ui");
      if (root) root.innerHTML = "";
    };
  }, []);

  return <div id="mobile-swagger-ui" className="min-h-screen" />;
}
