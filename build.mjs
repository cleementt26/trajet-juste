import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await mkdir('docs/assets',{recursive:true});
await rm('docs/assets',{recursive:true,force:true});
await mkdir('docs/assets',{recursive:true});
const result=await build({entryPoints:['src/main.mjs'],bundle:true,format:'iife',platform:'browser',target:'es2020',outdir:'docs/assets',entryNames:'app-[hash]',minify:true,metafile:true,logLevel:'warning'});
const script=Object.keys(result.metafile.outputs).find(file=>file.endsWith('.js'));
const css=await readFile('src/styles.css','utf8');
const cssFile=`styles-${createHash('sha256').update(css).digest('hex').slice(0,12)}.css`;
await writeFile(`docs/assets/${cssFile}`,css);
const html=(await readFile('src/index.html','utf8')).replace('{{SCRIPT}}',script.replace(/^docs\//,'./')).replace('{{STYLES}}',`./assets/${cssFile}`);
await writeFile('docs/index.html',html);
for(const name of ['communes.json','cars.json'])await copyFile(`data/${name}`,`docs/${name}`);
console.log('Built one browser script, versioned styles and local search data.');

await writeFile('docs/.nojekyll','');
