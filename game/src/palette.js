// DUSTLINE palette: dusk over a desert compound. Six base tones plus the two team
// colours; every material in the map is one of these, so the scene reads at a glance.
export const PALETTE = {
  sky: 0x232c3d, // dusk blue, also the fog colour
  ground: 0x9a7d55, // packed sand
  sandLight: 0xc2a06e, // sunlit sand / site floors
  concrete: 0x7d766c, // compound walls
  concreteDark: 0x5a534b, // shaded concrete
  rust: 0x8a4b2d, // corrugated steel, containers
  steel: 0x3d454e, // dark steel doors and frames
  accent: 0xf5a623, // amber: signs, site markers, UI accent
  ink: 0xefe9dc, // warm off-white text and trim
  muted: 0x8f96a0, // grey-blue secondary text
};

export const TEAM = {
  PHANTOM: { name: 'PHANTOM', color: 0xff6b35, css: '#ff6b35', dark: 0x7a2f12 },
  VANGUARD: { name: 'VANGUARD', color: 0x2ec4b6, css: '#2ec4b6', dark: 0x0f4a44 },
};
