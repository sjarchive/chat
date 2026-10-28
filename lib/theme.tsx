// Theme: one writer for the data-theme attribute, the browser UI theme-color,
// and the localStorage copy. The initial attribute is set before first paint
// by the inline script in app/layout.tsx (no flash of the wrong theme).

export type Theme = "dark" | "light";

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#ECE5DD" : "#0E1116");
  try {
    localStorage.setItem("circle-theme", theme);
  } catch {}
}

export function readStoredTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
