import sharp from "sharp"
import fs from "node:fs"
import path from "node:path"

const assets = "mobile/assets"

const iconSvg = fs.readFileSync(path.join(assets, "icon-source.svg"))
const adaptiveSvg = fs.readFileSync(path.join(assets, "adaptive-icon-source.svg"))

await sharp(iconSvg).resize(1024, 1024).png().toFile(path.join(assets, "icon.png"))
await sharp(adaptiveSvg).resize(1024, 1024).png().toFile(path.join(assets, "adaptive-icon.png"))
await sharp(iconSvg).resize(512, 512).png().toFile(path.join(assets, "favicon.png"))

for (const f of ["icon.png", "adaptive-icon.png", "favicon.png"]) {
  console.log(f, fs.statSync(path.join(assets, f)).size, "bytes")
}
