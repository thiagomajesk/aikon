import React from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import RootApp from "./RootApp";
import "@mantine/core/styles.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

const theme = createTheme({
  components: {
    Select: {
      defaultProps: {
        withCheckIcon: true,
        checkIconPosition: "right",
      },
    },
    Tooltip: {
      defaultProps: {
        withArrow: true,
      },
      styles: () => ({
        tooltip: {
          backgroundColor: "var(--mantine-color-dark-7)",
          color: "var(--mantine-color-gray-0)",
          border: "1px solid var(--mantine-color-dark-4)",
        },
        arrow: {
          backgroundColor: "var(--mantine-color-dark-7)",
          border: "1px solid var(--mantine-color-dark-4)",
        },
      }),
    },
  },
});

createRoot(root).render(
  <React.StrictMode>
    <MantineProvider forceColorScheme="dark" theme={theme}>
      <RootApp />
    </MantineProvider>
  </React.StrictMode>,
);
