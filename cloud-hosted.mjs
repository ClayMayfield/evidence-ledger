// Hosted staging entry. Deliberately contains no App Check debug mode.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app-check.js';
import {getAI,getGenerativeModel,GoogleAIBackend,InferenceMode,InferenceSource} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-ai.js';
import {runtime} from './runtime.mjs';
import {installCloudChart} from './cloud-chart.mjs';
const $=id=>document.getElementById(id);let model,payloadVersion=0,stale=false;
$('cloud-setup').hidden=true;
function payloadChanged(){payloadVersion++;$('status').textContent='Evidence changed. No explanation for the current text yet.';$('response').textContent='No explanation yet.';}
$('payload').addEventListener('input',payloadChanged);
window.addEventListener('message',event=>{if(event.origin!==runtime.reviewOrigin||event.source!==window.opener)return;if(event.data?.type==='ledger-cloud-invalidated'){stale=true;payloadVersion++;$('status').textContent='The review changed. This snapshot is out of date; prepare a new one before sending.';$('response').textContent='No current explanation.';return;}if(event.data?.type!=='ledger-cloud-evidence')return;const p=event.data.payload;if(!p||typeof p.status!=='string'||typeof p.evidence!=='string')return;stale=false;$('payload').value=`Check result: ${p.status}\nEvidence: ${p.evidence}\nNote: The observations were confirmed by a person and may not reflect the underlying data.`;payloadChanged();});
if(window.opener)window.opener.postMessage({type:'ledger-cloud-ready'},runtime.reviewOrigin);
function getModel(){
  if(model)return model;
  if(runtime.mode!=='hosted'||location.origin!==runtime.cloudOrigin||!runtime.firebaseConfig?.apiKey||!runtime.recaptchaSiteKey)throw new Error('Cloud setup is unavailable.');
  const app=initializeApp(runtime.firebaseConfig);initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(runtime.recaptchaSiteKey),isTokenAutoRefreshEnabled:true});model=getGenerativeModel(getAI(app,{backend:new GoogleAIBackend()}),{mode:InferenceMode.ONLY_IN_CLOUD});return model;
}
installCloudChart({getModel,inCloud:InferenceSource.IN_CLOUD,elements:{file:$('cloud-chart-file'),sample:$('cloud-chart-sample'),preview:$('cloud-chart-preview'),send:$('cloud-chart-send'),status:$('cloud-chart-status'),result:$('cloud-chart-result')}});
$('generate').addEventListener('click',async()=>{
  if(stale){$('status').textContent='The review changed. Prepare a new snapshot before sending.';return;}
  const input=$('payload').value.trim();if(!input){$('status').textContent='Add or prepare evidence before sending.';return;}
let activeModel;try{activeModel=getModel();}catch{$('status').textContent='Firebase setup failed. Check configuration and App Check.';return;}
  const requestVersion=payloadVersion;$('generate').disabled=true;$('status').textContent='Sending the reviewed text to Google…';$('response').textContent='Waiting for response.';
  try{const response=(await activeModel.generateContent('Explain the following structured chart-check evidence briefly for a report author. Do not infer unprovided data, and state that observations need human verification. Evidence:\n'+input)).response;if(payloadVersion!==requestVersion){$('status').textContent='Evidence changed during the request. The earlier response was not shown.';return;}$('response').textContent=response.text();$('status').textContent=response.inferenceSource===InferenceSource.IN_CLOUD?'Cloud response received. Review it before use.':'Response received; the SDK did not confirm cloud source.';}catch(e){if(payloadVersion!==requestVersion){$('status').textContent='Evidence changed during the request. No explanation for the current text.';return;}$('status').textContent=`Cloud request failed${e?.code?` (${e.code})`:''}. Check App Check, quota and configuration.`;$('response').textContent='No explanation was generated.';}finally{$('generate').disabled=false;}
});
