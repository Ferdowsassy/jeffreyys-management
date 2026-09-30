import {mkdir, copyFile, readdir, rm} from 'node:fs/promises';
const root = new URL('../public/ocr/', import.meta.url);
await rm(root,{recursive:true,force:true});
await mkdir(new URL('core/', root), {recursive:true});
await mkdir(new URL('lang/', root), {recursive:true});
await copyFile(new URL('../node_modules/tesseract.js/dist/worker.min.js', import.meta.url),new URL('worker.min.js',root));
const core = new URL('../node_modules/tesseract.js-core/',import.meta.url);
for (const name of await readdir(core))
  if (/-lstm\.wasm(?:\.js)?$/.test(name) || name==='LICENSE') await copyFile(new URL(name,core),new URL('core/'+name,root));
for (const language of ['deu','eng'])
  await copyFile(new URL(`../node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`,import.meta.url),new URL(`lang/${language}.traineddata.gz`,root));
console.log('Prepared self-hosted OCR worker, WASM engines and German/English language data');
