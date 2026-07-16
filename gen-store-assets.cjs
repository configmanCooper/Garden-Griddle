'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const assets = path.join(root, 'assets');
const play = path.join(root, 'play-assets');
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(play, { recursive: true });

function logoSvg(size, withBackground) {
  const background = withBackground ? `<rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#493224"/>` : '';
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      ${background}
      <circle cx="${size * 0.35}" cy="${size * 0.5}" r="${size * 0.22}" fill="#477f4b"/>
      <circle cx="${size * 0.65}" cy="${size * 0.5}" r="${size * 0.22}" fill="#c77b3b"/>
      <text x="${size * 0.35}" y="${size * 0.59}" text-anchor="middle" font-family="Arial" font-size="${size * 0.28}" font-weight="900" fill="#fff1cf">G</text>
      <text x="${size * 0.65}" y="${size * 0.59}" text-anchor="middle" font-family="Arial" font-size="${size * 0.28}" font-weight="900" fill="#fff1cf">G</text>
      <text x="${size * 0.5}" y="${size * 0.57}" text-anchor="middle" font-family="Arial" font-size="${size * 0.18}" font-weight="900" fill="#fff1cf">&amp;</text>
      <path d="M ${size * 0.15} ${size * 0.78} Q ${size * 0.5} ${size * 0.64} ${size * 0.85} ${size * 0.78}" fill="none" stroke="#e8af35" stroke-width="${size * 0.045}" stroke-linecap="round"/>
    </svg>`);
}

(async () => {
  await sharp(logoSvg(1024, true)).png().toFile(path.join(assets, 'icon-only.png'));
  await sharp(logoSvg(1024, false)).png().toFile(path.join(assets, 'icon-foreground.png'));
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#493224' } }).png().toFile(path.join(assets, 'icon-background.png'));

  const splashLogo = await sharp(logoSvg(1024, false)).resize(900, 900).png().toBuffer();
  for (const name of ['splash.png', 'splash-dark.png']) {
    await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#493224' } })
      .composite([{ input: splashLogo, gravity: 'centre' }])
      .png()
      .toFile(path.join(assets, name));
  }

  await sharp(logoSvg(512, true)).png().toFile(path.join(play, 'icon-512.png'));
  const featureSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#477f4b"/><stop offset="1" stop-color="#7b4527"/></linearGradient></defs>
      <rect width="1024" height="500" fill="url(#bg)"/>
      <circle cx="190" cy="250" r="145" fill="#fff1cf" opacity=".95"/>
      <text x="510" y="220" font-family="Arial" font-size="78" font-weight="900" fill="#fff1cf">Garden &amp; Griddle</text>
      <text x="515" y="292" font-family="Arial" font-size="34" fill="#ffe4a1">Grow together. Cook together.</text>
    </svg>`);
  const logo = await sharp(logoSvg(512, false)).resize(260, 260).png().toBuffer();
  await sharp(featureSvg).composite([{ input: logo, left: 60, top: 120 }]).png().toFile(path.join(play, 'feature-graphic.png'));
  console.log('Generated Android and Play Store art.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

