import sharp from 'sharp';
import {readdir, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(new URL('../public',import.meta.url).pathname);
const widths={};let original=0,derived=0;
for(const group of ['covers','ui']){
 await mkdir(`${root}/assets/responsive/${group}`,{recursive:true});
 for(const name of await readdir(`${root}/assets/${group}`)){
  if(!name.endsWith('.webp') || group==='ui'&&!name.startsWith('hero-')&&!['case-porsche.webp','promo-wide.webp','promo-casino.webp','promo-cases.webp'].includes(name))continue;
  const file=`${root}/assets/${group}/${name}`;const meta=await sharp(file).metadata();
  if(group==='covers')widths[name.slice(0,-5)]=meta.width;
  for(const width of group==='covers'||!name.startsWith('hero-')?[240,480]:[640,960]){
   if(width>=meta.width&&group==='ui')continue;
   await sharp(file).resize({width,withoutEnlargement:true}).webp({quality:92,alphaQuality:100,effort:5}).toFile(`${root}/assets/responsive/${group}/${name.slice(0,-5)}-${width}.webp`);
  }
 }
}
await writeFile(`${root}/image-sizes.js`,`// Original widths keep responsive image density exact.\nexport const coverWidths = ${JSON.stringify(widths)};\n`);
console.log('Responsive artwork generated; originals retained:',Object.keys(widths).length);
