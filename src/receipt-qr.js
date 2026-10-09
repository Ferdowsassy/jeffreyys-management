export async function readReceiptQR(canvases) {
  const {default:jsQR}=await import('jsqr');
  const values=new Set();
  for(const source of canvases) {
    const canvas=document.createElement('canvas');
    canvas.width=source.width;canvas.height=source.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(source,0,0);
    // Cover each detected code so a fiscal QR cannot hide a second Maps QR.
    for(let attempt=0;attempt<4;attempt++) {
      const code=jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});
      if(!code)break;
      values.add(code.data);
      const corners=[code.location.topLeftCorner,code.location.topRightCorner,code.location.bottomLeftCorner,code.location.bottomRightCorner];
      const x=Math.min(...corners.map(p=>p.x))-5,y=Math.min(...corners.map(p=>p.y))-5;
      ctx.fillStyle='white';ctx.fillRect(x,y,Math.max(...corners.map(p=>p.x))-x+5,Math.max(...corners.map(p=>p.y))-y+5);
    }
    canvas.width=canvas.height=1;
  }
  return [...values];
}
