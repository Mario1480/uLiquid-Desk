// Audit harness only. Uses synthetic identities and mock submission; does not listen on a port.
// Run from repository root: BINANCE_PERP_ENABLED=1 node node_modules/tsx/dist/cli.mjs docs/quality/security/2026-09-12-focused-defensive-audit/synthetic-probes.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from '../../../../apps/api/node_modules/express/index.js';
import { createPerpExecutionService } from '../../../../apps/api/src/execution/perp-execution-service.ts';
import { resolvePermissionRequirementForRequest as requirement, hasPermissionRequirement } from '../../../../apps/api/src/auth/permissions.ts';
import { registerSystemRoutes } from '../../../../apps/api/src/system/routes.ts';
import { getOrCreateRunnerFuturesAdapter } from '../../../../apps/runner/src/execution/futuresVenueRuntime.ts';
import { encryptSecret, decryptSecret } from '../../../../apps/api/src/secret-crypto.ts';
import { buildManualTradingErrorResponse } from '../../../../apps/api/src/manual-trading-error.ts';
import { redactAiSafetySecrets } from '../../../../apps/api/src/ai/safety/toolPolicy.ts';

async function main() {
 globalThis.fetch = async () => { throw new Error('AUDIT_NETWORK_FORBIDDEN'); };
 const results: Record<string, unknown>[] = [];
 for(const route of ['/mobile/trading/orders','/mobile/trading/orders/example/cancel','/mobile/trading/positions/close','/mobile/trading/positions/protection']) {
  const found=requirement('POST',route,{orderType:'market'});
  assert.equal(found,null);
  assert.equal(hasPermissionRequirement({},found),true);
  results.push({probe:'mobile permission mapping',route,noPermissionRequired:true});
 }
 for(const route of ['/API/ORDERS','/EXCHANGE-ACCOUNTS']) { assert.equal(requirement('POST',route,{type:'market'}),null); results.push({probe:'case-sensitive permission mapping',route,noPermissionRequired:true}); }
 const app=express(); app.post('/api/orders',(_req:any,_res:any)=>undefined); const orderLayer=(app as any)._router.stack.find((layer:any)=>layer.route?.path==='/api/orders'); assert.equal(orderLayer.match('/API/ORDERS'),true); results.push({probe:'Express route matching',uppercasePathMatchesOrderRoute:true});
 const inconsistent=requirement('POST','/api/orders',{orderType:'limit',type:'market'});
 assert.deepEqual(inconsistent,{any:['trading.manual_limit']});
 assert.equal(hasPermissionRequirement({'trading.manual_limit':true},inconsistent),true);
 results.push({probe:'order type alias mismatch',marketExecutionAuthorizedByLimitPermission:true});
 const routes=new Map<string,Function[]>(); let adminChecks=0;
 registerSystemRoutes({get:(p:string,...handlers:Function[])=>routes.set(p,handlers)} as any,{
  getQueueMetrics:async()=>({synthetic:true}),
  requireSuperadmin:async()=>{adminChecks++;return false;}
 } as any);
 const res:any={locals:{user:{id:'synthetic-user',email:'synthetic@example.invalid'}},code:200,status(n:number){this.code=n;return this;},json(x:any){this.body=x;return this;}};
 await routes.get('/admin/queue/metrics')!.at(-1)!({},res);
 assert.equal(adminChecks,0); assert.equal(res.code,200); assert.equal(res.body.synthetic,true);
 results.push({probe:'admin queue handler after authentication',adminChecks,status:res.code});
 const first=getOrCreateRunnerFuturesAdapter({cacheKey:'audit:synthetic',exchange:'binance',apiKey:'synthetic-old',apiSecret:'synthetic-old-secret'});
 const second=getOrCreateRunnerFuturesAdapter({cacheKey:'audit:synthetic',exchange:'binance',apiKey:'synthetic-new',apiSecret:'synthetic-new-secret'});
 assert.ok(first); assert.equal(first,second);
 results.push({probe:'runner credential rotation',sameAdapterAfterCredentialReplacement:true});
 let submissions=0; process.env.GLOBAL_TRADING_ENABLED='false'; process.env.TRADING_GLOBAL_DISABLED='true'; const account:any={id:'synthetic-account',userId:'synthetic-user',exchange:'binance',label:'Synthetic',apiKey:'synthetic',apiSecret:'synthetic',passphrase:null}; const service=createPerpExecutionService({isPaperTradingAccount:()=>false,createPerpExecutionAdapter:()=>({exchangeId:'binance',close:async()=>undefined,placeOrder:async()=>{submissions++;return {orderId:'synthetic-order'};}} as any),createPerpMarketDataClient:()=>{throw new Error('unexpected read');}}); await service.placeOrder({resolved:{selectedAccount:account,marketDataAccount:account},symbol:'BTCUSDT',side:'buy',type:'market',qty:1}); assert.equal(submissions,1); results.push({probe:'manual service global halt',mockAdapterCalledDespiteGlobalHalt:true});
 process.env.SECRET_MASTER_KEY=crypto.randomBytes(32).toString('hex');
 const synthetic='audit-only-not-a-real-credential';
 const a=encryptSecret(synthetic), b=encryptSecret(synthetic);
 assert.notEqual(a,b); assert.equal(decryptSecret(a),synthetic);
 const parts=a.split('.');const cipher=Buffer.from(parts[3],'base64');cipher[0]^=1;parts[3]=cipher.toString('base64');
 assert.throws(()=>decryptSecret(parts.join('.')));
 results.push({probe:'credential encryption',randomizedCiphertext:true,roundTrip:true,tamperRejected:true});
 const leak=buildManualTradingErrorResponse(new Error('apiSecret='+synthetic));
 assert.ok(String(leak.payload.message).includes(synthetic));
 results.push({probe:'manual error response',syntheticSecretSurvives:true});
 const redacted=redactAiSafetySecrets({apiSecret:synthetic});
 assert.equal((redacted as any).apiSecret,'[REDACTED]');
 results.push({probe:'AI structured output redaction',knownSecretFieldRedacted:true});
 const root=fileURLToPath(new URL('../../../../', import.meta.url));
 const runtime=fs.readFileSync(root+'/apps/api/src/ai/agent-chat/runtime.ts','utf8');
 assert.ok(runtime.includes('message: params.userMessage'));
 results.push({probe:'AI input source',rawUserMessageAtModelBoundary:true});
 console.log(JSON.stringify({kind:'synthetic local probes; no network, database, LLM or orders',results},null,2)); process.exit(0);
}
main().catch(e=>{console.error({probeFailed:e instanceof Error?e.stack:'unknown'});process.exitCode=1;});
