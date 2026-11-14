export const themes = [
  {
    id: "amethyst",
    name: "Amethyst",
    note: "Velvet purple · rose light",
    colors: ["#181322", "#bfa1e7", "#ebadc8"],
  },
  {
    id: "rose",
    name: "Rose",
    note: "Dusky pink · soft copper",
    colors: ["#21131c", "#e3a1c3", "#edbbab"],
  },
  {
    id: "crimson",
    name: "Crimson",
    note: "Oxblood · warm scarlet",
    colors: ["#211314", "#e6a4ab", "#e9b38e"],
  },
  {
    id: "gilded",
    name: "Gilded",
    note: "Midnight amber · old gold",
    colors: ["#1c1911", "#d8c591", "#ebc88f"],
  },
  {
    id: "observatory",
    name: "Observatory",
    note: "Original · teal & copper",
    colors: ["#101718", "#9ac4b0", "#e9b68e"],
  },
];
export const currentTheme = (state) =>
  themes.some((t) => t.id === state.appearance?.theme)
    ? state.appearance.theme
    : "amethyst";
export function themeChooser(state) {
  return `<section class="panel appearance-panel"><div class="section-heading"><div><p class="eyebrow">SET THE MOOD</p><h2>A room for your imagination.</h2><p>Choose a palette. Observatory keeps the original colors.</p></div></div><div class="theme-grid">${themes.map((t) => `<button class="theme-choice" data-action="theme" data-id="${t.id}" aria-pressed="${currentTheme(state) === t.id}" aria-label="${t.name} palette"><span class="theme-swatches" aria-hidden="true">${t.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span><strong>${t.name}</strong><small>${t.note}</small><span class="theme-check" aria-hidden="true">${currentTheme(state) === t.id ? "✓" : "○"}</span></button>`).join("")}</div></section>`;
}
