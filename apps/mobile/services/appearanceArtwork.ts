import { AccentColor } from "./appearancePalette";
const artwork = {
  black: require("../assets/appearance/black.png"),
  red: require("../assets/icon.png"), blue: require("../assets/appearance/blue.png"),
  green: require("../assets/appearance/green.png"), teal: require("../assets/appearance/teal.png"),
  purple: require("../assets/appearance/purple.png"), orange: require("../assets/appearance/orange.png")
};
export function appearanceArtwork(accent: AccentColor) { return artwork[accent]; }
