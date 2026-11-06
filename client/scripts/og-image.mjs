// Draws the share image once. Run again only when the brand changes: node scripts/og-image.mjs
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f3f6f5"/>
  <rect x="0" y="0" width="1200" height="12" fill="#0e7c66"/>
  <text x="80" y="150" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#10302e">website<tspan fill="#0e7c66">→</tspan>app</text>
  <text x="80" y="300" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#10302e">Your website,</text>
  <text x="80" y="390" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#10302e">as an Android app.</text>
  <text x="80" y="470" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#5b6f6c">Free Website to App Converter</text>
  <rect x="860" y="110" width="250" height="440" rx="40" fill="#10302e"/>
  <rect x="876" y="126" width="218" height="34" rx="24" fill="#0e7c66"/>
  <rect x="876" y="160" width="218" height="374" fill="#ffffff"/>
  <rect x="940" y="300" width="90" height="90" rx="24" fill="#0e7c66"/>
  <rect x="965" y="325" width="40" height="40" rx="10" fill="#f2b33d"/>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL('../public/og.png', import.meta.url)));
console.log('wrote public/og.png');
