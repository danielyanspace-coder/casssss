import{mkdir,writeFile}from'node:fs/promises';import{iconCoin}from'../public/icons.js';
import{HD_THEMES,itemArtHd}from'../public/item-art-hd.js';import{HD_SPECIAL_SAMPLES}from'../public/hd/special.js';
const keys=[...Object.entries(HD_THEMES).flatMap(([theme,draws])=>draws.map((_,i)=>`${theme}/${i}`)),...HD_SPECIAL_SAMPLES];
for(const key of keys){const svg=itemArtHd(key);if(!svg)throw new Error(`Missing art ${key}`);const path=new URL(`../public/assets/items/${key}.svg`,import.meta.url);await mkdir(new URL('.',path),{recursive:true});await writeFile(path,svg.includes('xmlns=')?svg:svg.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"'));}
await writeFile(new URL('../public/feed-art-keys.js',import.meta.url),`// Same vector paths as the live HD renderer, served as independent SVG documents.\nexport const feedArtKeys = new Set(${JSON.stringify(keys)});\n`);console.log('Original feed vectors:',keys.length);

const coin=iconCoin();await writeFile(new URL('../public/assets/items/coin.svg',import.meta.url),coin.includes('xmlns=')?coin:coin.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"'));
