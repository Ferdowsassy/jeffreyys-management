import {parseReceipt} from './receipt-parser';
import {readReceiptQR} from './receipt-qr';
import {mapsURL, addressFromMaps} from '../shared/receipt-maps';

async function prepareImage(file) {
  const url=URL.createObjectURL(file), image=new Image();
  try {
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Foto konnte nicht geöffnet werden. Bitte JPEG, PNG oder WebP verwenden.'));image.src=url;});
    const sample=document.createElement('canvas');
    const scale=Math.min(1,600/image.naturalWidth,900/image.naturalHeight);
    sample.width=Math.max(1,Math.round(image.naturalWidth*scale));sample.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,sample.width,sample.height);
    const {data}=ctx.getImageData(0,0,sample.width,sample.height);
    const mask=new Uint8Array(sample.width*sample.height);
    for(let i=0;i<mask.length;i++)mask[i]=(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114)>170?1:0;
    const queue=new Int32Array(mask.length);
    let largest=null;
    for(let start=0;start<mask.length;start++) {
      if(!mask[start])continue;
      let head=0,tail=1,minX=sample.width,minY=sample.height,maxX=0,maxY=0;
      queue[0]=start;mask[start]=0;
      while(head<tail) {
        const index=queue[head++],x=index%sample.width,y=Math.floor(index/sample.width);
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        const neighbors=[x>0?index-1:-1,x<sample.width-1?index+1:-1,y>0?index-sample.width:-1,y<sample.height-1?index+sample.width:-1];
        for(const n of neighbors)if(n>=0 && mask[n]){mask[n]=0;queue[tail++]=n;}
      }
      if(!largest || tail>largest.count)largest={count:tail,minX,minY,maxX,maxY};
    }
    let sx=0,sy=0,sw=image.naturalWidth,sh=image.naturalHeight;
    if(largest && largest.count>mask.length*.12 && largest.maxX-largest.minX>sample.width*.18 && largest.maxY-largest.minY>sample.height*.25) {
      sx=Math.max(0,(largest.minX+3)/scale);sy=Math.max(0,(largest.minY-3)/scale);
      sw=Math.min(image.naturalWidth-sx,(largest.maxX-largest.minX)/scale);
      sh=Math.min(image.naturalHeight-sy,(largest.maxY-largest.minY+6)/scale);
    }
    const output=document.createElement('canvas'), resize=Math.min(3,1500/sw,4800/sh,Math.sqrt(7200000/(sw*sh)));
    output.width=Math.max(1,Math.round(sw*resize));output.height=Math.max(1,Math.round(sh*resize));
    const out=output.getContext('2d',{willReadFrequently:true});out.imageSmoothingQuality='high';out.drawImage(image,Math.round(sx),Math.round(sy),Math.round(sw),Math.round(sh),0,0,output.width,output.height);
    const original=document.createElement('canvas'), qrScale=Math.min(1,2000/image.naturalHeight,1600/image.naturalWidth);
    original.width=Math.round(image.naturalWidth*qrScale);original.height=Math.round(image.naturalHeight*qrScale);
    original.getContext('2d').drawImage(image,0,0,original.width,original.height);
    const qrCodes=await readReceiptQR([original,output]);
    original.width=original.height=1;
    const pixels=out.getImageData(0,0,output.width,output.height);
    let sum=0;
    for(let i=0;i<pixels.data.length;i+=4)sum+=pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114;
    const mean=sum/(pixels.data.length/4);
    for(let i=0;i<pixels.data.length;i+=4){const gray=(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114-mean)*1.25+mean;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=gray;}
    out.putImageData(pixels,0,0);
    const title=document.createElement('canvas');
    title.width=output.width;title.height=Math.round(output.height*.16);
    title.getContext('2d').drawImage(output,0,0,title.width,title.height,0,0,title.width,title.height);
    // A separate pass on the upper-left block avoids large handwritten marks
    // swallowing the customer address during page segmentation.
    const header=document.createElement('canvas');
    header.width=Math.round(output.width*.6);header.height=Math.round(output.height*.34);
    const headerContext=header.getContext('2d',{willReadFrequently:true});
    headerContext.drawImage(output,0,0,header.width,header.height,0,0,header.width,header.height);
    const headerPixels=headerContext.getImageData(0,0,header.width,header.height);
    for(let i=0;i<headerPixels.data.length;i+=4){const value=headerPixels.data[i]>200?255:0;headerPixels.data[i]=headerPixels.data[i+1]=headerPixels.data[i+2]=value;}
    headerContext.putImageData(headerPixels,0,0);
    return {image:output,header,title,qrCodes};
  } finally {URL.revokeObjectURL(url);}
}

export async function scanReceipt(file, onProgress=()=>{}, {resolveMaps}={}) {
  onProgress('Foto vorbereiten …');
  const {image,header,title,qrCodes}=await prepareImage(file);
  const {createWorker}=await import('tesseract.js');
  let worker, timer, expired=false;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Texterkennung dauert zu lange. Bitte erneut versuchen oder den Beleg manuell erfassen.'));},120000);});
  const withinLimit=operation=>Promise.race([operation,timeout]);
  try {
    worker=await withinLimit(createWorker('deu+eng',1,{
      workerPath:'/ocr/worker.min.js',corePath:'/ocr/core',langPath:'/ocr/lang',workerBlobURL:false,
      errorHandler:()=>{},
      logger:message=>onProgress(message.status==='recognizing text'?`Text lesen … ${Math.round((message.progress||0)*100)} %`:'Texterkennung laden …'),
    }).then(async created=>{if(expired){await created.terminate();throw Error('Texterkennung abgebrochen.');}return created;}));
    await withinLimit(worker.setParameters({tessedit_pageseg_mode:'6'}));
    const {data}=await withinLimit(worker.recognize(image));
    if(!data.text.trim())throw Error('Kein lesbarer Text erkannt. Bitte ein scharfes Foto bei gutem Licht aufnehmen oder den Beleg manuell erfassen.');
    const parsed=parseReceipt(data.text);
    let titleText='';
    if(!parsed.draft.orderNumber) {
      onProgress('Bestellnummer lesen …');
      const titleResult=await withinLimit(worker.recognize(title));
      titleText=titleResult.data.text;
      const titleDraft=parseReceipt(titleText).draft;
      if(titleDraft.orderNumber) {
        parsed.draft.orderNumber=titleDraft.orderNumber;
        parsed.warnings=parsed.warnings.filter(message=>!/^Bestellnummer nicht/.test(message));
        parsed.warnings.push('Bestellnummer unsicher gelesen. Bitte 0/O, 6/G und 4/A mit dem Originalbeleg vergleichen.');
      }
    }
    let qrAddress=null, mapsCode=null;
    for(const code of qrCodes) {
      if(!mapsURL(code))continue;
      mapsCode=code;
      qrAddress=addressFromMaps(code);
      if(!qrAddress && resolveMaps) {
        onProgress('Google-Maps-Adresse lesen …');
        try {qrAddress=await resolveMaps(code);} catch(error) {parsed.warnings.push(error.message || 'Maps-Link konnte nicht gelesen werden. Bitte die Adresse vom Beleg prüfen.');}
      }
      if(qrAddress)break;
    }
    onProgress('Kundenadresse prüfen …');
    const upper=await withinLimit(worker.recognize(header)), address=parseReceipt(upper.data.text).draft;
    if(address.address && address.postalCode && address.city && (!parsed.draft.city || address.city===parsed.draft.city)) {
      if(parsed.draft.address && parsed.draft.address!==address.address)parsed.warnings.push('Adresse unterschiedlich gelesen. Bitte mit dem Originalbeleg vergleichen.');
      for(const key of ['address','postalCode','city'])parsed.draft[key]=address[key];
      parsed.warnings=parsed.warnings.filter(message=>!/^Adresse nicht|^PLZ nicht|^Ort nicht/.test(message));
    }
    if(qrAddress) {
      if(parsed.draft.address && ['address','postalCode','city'].some(key=>parsed.draft[key] && parsed.draft[key]!==qrAddress[key]))parsed.warnings.push('QR-Code und Belegtext zeigen unterschiedliche Adressen. Bitte prüfen.');
      Object.assign(parsed.draft,qrAddress);
      parsed.warnings=parsed.warnings.filter(message=>!/^Adresse nicht|^PLZ nicht|^Ort nicht/.test(message));
    } else if(mapsCode)parsed.warnings.push('Maps-QR erkannt, aber keine vollständige Postadresse gefunden. Bitte ergänzen.');
    else if(qrCodes.length)parsed.warnings.push('QR-Code enthält keine Google-Maps-Adresse (z. B. Steuerdaten). Adresse bitte aus dem Beleg prüfen.');
    if(data.confidence<75)parsed.warnings.push('Das Foto ist teilweise schwer lesbar. Bitte alle Angaben sorgfältig prüfen.');
    return {...parsed,addressSource:qrAddress?'qr':'text',mapsLink:mapsCode,text:data.text+'\n\nKundenbereich:\n'+upper.data.text+(titleText?'\n\nBestellkopf:\n'+titleText:''),confidence:data.confidence};
  } finally {clearTimeout(timer);if(worker)await worker.terminate();image.width=image.height=header.width=header.height=title.width=title.height=1;}
}
