// Rasterize the existing editable SVG; retain the original red PNG unchanged.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { PNG } = require("pngjs");
const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "apps/mobile/assets/brand-logo.svg"), "utf8");
const presets = require(path.join(root, "apps/mobile/services/appearancePresets.json"));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const directory = path.join(root, "apps/mobile/assets/appearance");
    fs.mkdirSync(directory, { recursive: true });
    for (const [name, { color }] of Object.entries(presets)) {
      if (name === "red") continue;
      const result = await page.evaluate(async ({ source, color }) => {
        const document = new DOMParser().parseFromString(source, "image/svg+xml");
        const frame = "#" + [1, 3, 5].map(index => Math.round(parseInt(color.slice(index, index + 2), 16) * .16 + 255 * .84).toString(16).padStart(2, "0")).join("");
        for (const node of document.querySelectorAll("[fill]")) {
          if (node.getAttribute("fill") === "#d71920") node.setAttribute("fill", color);
          else if (node.getAttribute("fill") === "#ffd9d6") node.setAttribute("fill", frame);
        }
        const svg = new XMLSerializer().serializeToString(document);
        const image = new Image();
        image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        await image.decode();
        const canvas = window.document.createElement("canvas"); canvas.width = 1024; canvas.height = 1024;
        canvas.getContext("2d").drawImage(image, 0, 0);
        return { svg, png: canvas.toDataURL("image/png").split(",")[1] };
      }, { source, color });
      fs.writeFileSync(path.join(directory, name + ".svg"), result.svg);
      fs.writeFileSync(path.join(directory, name + ".png"), PNG.sync.write(PNG.sync.read(Buffer.from(result.png, "base64")), { colorType: 2 }));
      console.log("Generated", name);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
