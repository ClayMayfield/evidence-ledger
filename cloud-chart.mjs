// Runs only on the separate cloud origin. A selection is read locally for
// preview; the sole network-producing operation is the explicit Send click.
const PROMPT='Read only values clearly labeled in this chart. Return JSON only: {"observations":[{"label":"...","value":"...","unit":"..."}]}. Use the unit explicitly shown exactly as text; normalize grams to g and kilograms to kg. If no unit is clear use an empty unit. Do not invent values. If uncertain return an empty observations array.';
const maxBytes=4*1024*1024;

export async function readImageForPreview(file) {
  const dataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Image could not be read.'));reader.readAsDataURL(file);
  });
  if(typeof dataUrl!=='string'||!dataUrl.startsWith(`data:${file.type};base64,`))throw new Error('Image format is unsupported.');
  const image=new Image();image.src=dataUrl;await image.decode();
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>8000||image.naturalHeight>8000||image.naturalWidth*image.naturalHeight>12000000)throw new Error('Image dimensions exceed the limit.');
  return dataUrl;
}

export async function createSyntheticChart() {
  const c=document.createElement('canvas');c.width=960;c.height=540;const x=c.getContext('2d');
  x.fillStyle='white';x.fillRect(0,0,960,540);x.fillStyle='#183b34';x.textAlign='center';x.font='bold 36px Arial';x.fillText('Weight in kilograms — SAMPLE',480,55);x.strokeStyle='#96aaa0';x.beginPath();x.moveTo(130,115);x.lineTo(130,435);x.lineTo(860,435);x.stroke();x.fillStyle='#2e7564';x.fillRect(250,265,150,170);x.fillRect(565,180,150,255);x.fillStyle='#17362e';x.font='bold 29px Arial';x.fillText('8',325,250);x.fillText('12',640,165);x.font='26px Arial';x.fillText('Box A',325,480);x.fillText('Box B',640,480);
  const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('Sample could not be generated.');
  return new File([blob],'synthetic-sample.png',{type:'image/png'});
}

export function installCloudChart({elements, getModel, inCloud, readPreview=readImageForPreview, createSample=createSyntheticChart}) {
  const {file,sample,preview,send,status,result}=elements;
  let version=0, selected=null, sending=false;
  const runningNotice=' An earlier image request is still running; changing the selection does not cancel it.';
  const earlierRequest=()=>sending?runningNotice:'';
  async function chooseImage(load){
    const current=++version;selected=null;send.disabled=true;
    preview.hidden=true;preview.removeAttribute('src');result.textContent='No suggestions yet.';
    status.textContent='Checking the current selection locally…'+earlierRequest();
    try{
      const chosen=await load();if(current!==version)return;
      if(!chosen){status.textContent='No current image selected.'+earlierRequest();return;}
      if(!['image/png','image/jpeg'].includes(chosen.type)||chosen.size>maxBytes){status.textContent='Choose a PNG or JPEG no larger than 4 MB.'+earlierRequest();return;}
      const dataUrl=await readPreview(chosen);if(current!==version)return;
      selected={dataUrl,type:chosen.type};preview.src=dataUrl;preview.hidden=false;send.disabled=sending;
      status.textContent='Current selection ready to review; it has not been sent. Choose Send to share it with Google.'+earlierRequest();
    }catch{
      if(current!==version)return;
      status.textContent='Current selection could not be decoded or exceeds the dimension limits; it was not sent.'+earlierRequest();
    }
  }
  file.addEventListener('change',()=>{const chosen=file.files?.[0];file.value='';return chooseImage(()=>chosen);});
  sample.addEventListener('click',()=>chooseImage(createSample));
  send.addEventListener('click',async()=>{
    if(!selected||sending)return;
    const current=version, image=selected;sending=true;send.disabled=true;
    result.textContent='No suggestions yet.';status.textContent='Sending the selected image to Google…';
    try{
      const model=getModel();
      const data=image.dataUrl.slice(image.dataUrl.indexOf(',')+1);
      const response=(await model.generateContent([PROMPT,{type:'inlineData',inlineData:{data,mimeType:image.type}}])).response;
      if(version!==current)return;
      if(response.inferenceSource!==inCloud){status.textContent='The SDK did not confirm a cloud response; no suggestion was shown.';return;}
      result.textContent=response.text();
      status.textContent='Cloud suggestions received. Verify every detail against the chart before entering observations.';
    }catch(e){
      if(version!==current)return;
      status.textContent=`Cloud chart request failed${e?.code?` (${e.code})`:''}. Check App Check, quota and configuration.`;
      result.textContent='No suggestions were generated.';
    }finally{sending=false;send.disabled=!selected;if(version!==current){if(selected)status.textContent='Current selection ready to review; it has not been sent. The earlier request has finished. Choose Send to share the current image with Google.';else status.textContent=status.textContent.replace(runningNotice,'')+' The earlier request has finished.';}}
  });
}
