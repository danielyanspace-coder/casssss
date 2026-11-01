import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url).pathname;
await import('./build-legal-summary.mjs');
const dir=process.env.CLIENT_RELEASE || 'release-20261031-v2';
await mkdir(`${root}public/${dir}`,{recursive:true});
const js=await build({absWorkingDir:root,entryPoints:{app:'public/app.js',boot:'public/boot.js'},outdir:`public/${dir}`,define:{__LB_ART_BASE__:JSON.stringify('/hd/')},bundle:true,splitting:true,format:'esm',target:['chrome100','safari16'],minify:true,legalComments:'none',charset:'utf8',chunkNames:'chunks/[name]-[hash]',metafile:true});
await build({absWorkingDir:root,entryPoints:['public/styles.css'],outfile:`public/${dir}/styles.css`,minify:true,legalComments:'none',charset:'utf8'});
for(const file of ['index.html','app-shell.html']){
 let text=await readFile(`${root}public/${file}`,'utf8');
 text=text.replace(/\/release-[a-zA-Z0-9-]+\//g,`/${dir}/`);
 if (file === 'index.html') {
  const seen=new Set();
  const visit=path=>{for(const dep of js.metafile.outputs[path]?.imports||[])if(dep.kind==='import-statement'&&!seen.has(dep.path)){seen.add(dep.path);visit(dep.path);}};
  visit(`public/${dir}/app.js`);
  const links=[...seen].map(path=>`<link rel="modulepreload" href="/${path.slice('public/'.length)}">`).join('\n');
  text=text.replace(/<!-- client-dependencies -->[\s\S]*?<!-- \/client-dependencies -->\n?/g,'');
  text=text.replace('</head>',`<!-- client-dependencies -->\n${links}\n<!-- /client-dependencies -->\n</head>`);
 }
 text=text.replaceAll("'/boot.js'",`'/${dir}/boot.js'`).replaceAll('src="/boot.js"',`src="/${dir}/boot.js"`);
 text=text.replaceAll('href="/app.js?v=launch-20261030"',`href="/${dir}/app.js"`).replace(/src="\/app\.js[^\"]*"/g,`data-app-entry src="/${dir}/app.js"`);
 text=text.replaceAll('href="/styles.css"',`href="/${dir}/styles.css"`);
 text=text.replace("doc.querySelector('script[src^=\"/app.js\"]')", "doc.querySelector('script[data-app-entry], script[src^=\"/app.js\"]')");
 text=text.replace("link.getAttribute('href')==='/styles.css'", "link.media!=='print'");
 await writeFile(`${root}public/${file}`,text);
}
await writeFile(`${root}client-build.json`,JSON.stringify(js.metafile,null,2));
for (const file of await readdir(`${root}public/${dir}`,{recursive:true})) {
 if (/\.(?:js|css)$/.test(file)) await writeFile(`${root}public/${dir}/${file}.gz`,gzipSync(await readFile(`${root}public/${dir}/${file}`),{level:9}));
}
console.log('Built minified ES modules, lazy art chunks, CSS and precompressed files');
