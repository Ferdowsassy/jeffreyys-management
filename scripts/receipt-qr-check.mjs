import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {mapsURL, addressFromMaps} from '../shared/receipt-maps.js';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.addScriptTag({path:'node_modules/jsqr/dist/jsQR.js'});
  for(const path of process.argv.slice(2)) {
    const source='data:image/jpeg;base64,'+(await readFile(path)).toString('base64');
    const code=await page.evaluate(async src=>{
      const img=new Image();img.src=src;await img.decode();
      for(const bottom of [0,.55,.75])for(const scale of [1,2,.7]) {
        const c=document.createElement('canvas');c.width=img.naturalWidth*scale+80;c.height=img.naturalHeight*(1-bottom)*scale+80;
        const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
        ctx.drawImage(img,0,img.naturalHeight*bottom,img.naturalWidth,img.naturalHeight*(1-bottom),40,40,img.naturalWidth*scale,img.naturalHeight*(1-bottom)*scale);
        const code=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
        if(code)return code.data;
      }
    },source);
    console.log(path.split('/').at(-1), code ? mapsURL(code) ? {type:'Maps',address:addressFromMaps(code)} : {type:'Fiscal or other QR'} : {type:'No readable QR'});
  }
} finally {await browser.close();}
