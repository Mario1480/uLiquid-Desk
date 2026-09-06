import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
const [baseline,current=process.cwd()]=process.argv.slice(2);
if(!baseline)throw new Error("Usage: node scripts/measure_einui_bundles.mjs BASELINE_REPO [CURRENT_REPO]");
const routes=["page","login/page","trade/page","bots/page","agent-chat/page","settings/page","wallet/page","uliq/page","admin/system/page"];
function read(repo,route){
 const next=path.join(repo,"apps/web/.next");
 const context={globalThis:{}};
 vm.runInNewContext(fs.readFileSync(path.join(next,"server/app",route+"_client-reference-manifest.js"),"utf8"),context);
 const manifest=Object.values(context.globalThis.__RSC_MANIFEST)[0];
 for(const source of Object.keys(manifest.clientModules)) assert.ok(!/\/einui\/(?:gallery|blocks|widgets|innovative)\//.test(source),`Unexpected gallery module in ${route}: ${source}`);
 const sum=files=>[...new Set(files)].reduce((total,file)=>{const content=fs.readFileSync(path.join(next,file));return {bytes:total.bytes+content.length,gzipBytes:total.gzipBytes+gzipSync(content).length,files:total.files+1}},{bytes:0,gzipBytes:0,files:0});
 return {js:sum(Object.values(manifest.entryJSFiles).flat()),css:sum(Object.values(manifest.entryCSSFiles).flat().map(v=>v.path))};
}
console.log(JSON.stringify({method:"Unique initial assets referenced by Next client manifests; gzip per file, not observed network transfer. Same Next/Turbopack production mode. Gallery module isolation checked.",routes:routes.map(route=>{const before=read(baseline,route),after=read(current,route);return {route,before,after,delta:{jsBytes:after.js.bytes-before.js.bytes,jsGzipBytes:after.js.gzipBytes-before.js.gzipBytes,cssBytes:after.css.bytes-before.css.bytes,cssGzipBytes:after.css.gzipBytes-before.css.gzipBytes}}})},null,2));
