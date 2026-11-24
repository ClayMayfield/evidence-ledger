import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,realpath,rm,unlink,readdir} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url)),builder=join(root,'build-staging.mjs'),example=join(root,'release.example.json');

test('stages separated origins without embedding the cloud config in the review page or a debug provider',async()=>{
  const output=execFileSync(process.execPath,[builder,example],{encoding:'utf8'});
  const match=output.match(/^Staging prepared at (.+)\. No deployment was performed\./m);assert.ok(match);
  const stage=await realpath(match[1]),rootReal=await realpath(root);
  assert.equal(dirname(stage),rootReal);assert.ok(basename(stage).startsWith('.staging-'));
  try{
    const read=(...p)=>readFile(join(stage,...p),'utf8');
    const review=await read('review','runtime.mjs'),cloud=await read('cloud','runtime.mjs'),hosted=await read('cloud','cloud.mjs');
    const hosting=JSON.parse(await read('firebase.json')).hosting;
    assert.ok(review.includes('https://review.example.invalid'));assert.ok(!review.includes('firebaseConfig'));
    assert.ok(cloud.includes('synthetic-project'));assert.ok(hosted.includes('ReCaptchaEnterpriseProvider'));
    assert.ok(!hosted.includes('FIREBASE_APPCHECK_DEBUG_TOKEN'));assert.ok(!hosted.includes('localhost-debug-placeholder'));
    assert.equal(hosting.length,2);assert.match(hosting[0].headers[0].headers[0].value,/connect-src data:/);
    assert.match(hosting[1].headers[0].headers[0].value,/firebasevertexai\.googleapis\.com/);
    assert.match(hosting[1].headers[0].headers[0].value,/content-firebaseappcheck\.googleapis\.com/);
    // The cloud entry has no extension. With nosniff enabled it must be served
    // as HTML for the browser to render it; Firebase matches header rules in order.
    for(const target of hosting) {
      const common=target.headers.find(h=>h.source==='**');
      assert.ok(common.headers.some(h=>h.key==='X-Content-Type-Options'&&h.value==='nosniff'));
      const modules=target.headers.find(h=>h.source==='**/*.mjs');
      assert.ok(modules.headers.some(h=>h.key==='Content-Type'&&h.value.startsWith('application/javascript')));
    }
    const htmlRoute=hosting[1].headers.find(h=>h.source==='/ledger-cloud');
    assert.ok(htmlRoute.headers.some(h=>h.key==='Content-Type'&&h.value.startsWith('text/html')));
    // Resolve the locally referenced HTML assets and their local ES imports in
    // each target; external SDK availability still needs a live test.
    for(const [site,entry,origin] of [['review','index.html','https://review.example.invalid'],['cloud','ledger-cloud','https://cloud.example.invalid']]) {
      const checked=new Set();
      async function checkAsset(path) {
        if(checked.has(path))return; checked.add(path);
        const source=await read(site,path);
        const refs=path.endsWith('.mjs')
          ? [...source.matchAll(/\b(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)].map(m=>m[1])
          : [...source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]);
        for(const ref of refs) {
          if(ref.startsWith('#')||/^(?:https?:|data:|blob:)/.test(ref))continue;
          const url=new URL(ref,`${origin}/${path}`);
          assert.equal(url.origin,origin);
          const child=decodeURIComponent(url.pathname).replace(/^\//,'');
          if(child.endsWith('.mjs'))await checkAsset(child); else assert.ok((await read(site,child)).length>0,`${site}/${child} is empty`);
        }
      }
      await checkAsset(entry);
    }
    assert.ok((await read('review','core.mjs')).includes('./vendor/decimal.mjs'));
    assert.ok((await read('review','vendor','decimal.mjs')).length>1000);
    assert.match(await read('review','LICENSES','PapaParse-MIT.txt'),/Matthew Holt/);
    assert.match(await read('review','LICENSES','decimal.js-MIT.txt'),/Michael Mclaughlin/);
  }finally{await rm(stage,{recursive:true});}
});

test('rejects equal origins, unconfirmed projects and unknown Firebase config fields before generating output',async()=>{
  const base=JSON.parse(await readFile(example,'utf8'));
  const path=join(root,`.staging-test-${randomUUID()}.private.json`);
  const before=(await readdir(root)).filter(x=>x.startsWith('.staging-')&&!x.endsWith('.json')).sort();
  try{
    for(const c of [{...base,cloudOrigin:base.reviewOrigin},{...base,confirmedNonProduction:false},{...base,firebaseConfig:{...base.firebaseConfig,clientSecret:'not-real'}}]){
      await writeFile(path,JSON.stringify(c));assert.throws(()=>execFileSync(process.execPath,[builder,path],{stdio:'pipe'}));
    }
    const after=(await readdir(root)).filter(x=>x.startsWith('.staging-')&&!x.endsWith('.json')).sort();assert.deepEqual(after,before);
  }finally{await unlink(path);}
});
test('rejects an unprotected config filename inside the repository',async()=>{
  const path=join(root,`.unsafe-test-${randomUUID()}.json`);
  try{await writeFile(path,await readFile(example));assert.throws(()=>execFileSync(process.execPath,[builder,path],{stdio:'pipe'}));}finally{await unlink(path);}
});
