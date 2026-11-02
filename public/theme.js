// Loaded before the page draws so a saved theme never flashes the wrong colors.
// "auto" follows the device's setting, including when it changes while the app is open.
(function () {
  const KEY = "torchrep.theme";
  const BAR_COLORS = { dark: "#160219", light: "#faf6fb" };
  const deviceLight = matchMedia("(prefers-color-scheme: light)");

  function themeChoice() {
    try {
      const saved = localStorage.getItem(KEY);
      return saved === "light" || saved === "dark" ? saved : "auto";
    } catch {
      return "auto";
    }
  }

  function applyTheme() {
    const choice = themeChoice();
    const theme = choice === "auto" ? (deviceLight.matches ? "light" : "dark") : choice;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR_COLORS[theme]);
  }

  window.themeChoice = themeChoice;
  window.setThemeChoice = function (choice) {
    try {
      if (choice === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* private browsing can block storage; the choice still applies below for this page */
    }
    applyTheme();
  };

  deviceLight.addEventListener("change", applyTheme);
  applyTheme();
})();
