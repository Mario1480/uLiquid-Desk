/** Read-only local UI QA fixture. Never point a deployed app at this server. */
import http from "node:http";
const port = Number(process.env.EINUI_MOCK_PORT || 4401);
const server = http.createServer((req, res) => {
  const allowedOrigins = [3301, 3302, 3303].flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (allowedOrigins.includes(req.headers.origin)) res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({error:"mock_mutation_blocked"})); return; }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/ui-fixture-session") {
    // Use only in a private browser window; this is a dummy loopback cookie, not an account.
    res.writeHead(302, {"Set-Cookie":"mm_session=local-ui-fixture; Path=/; SameSite=Lax; HttpOnly",Location:"http://localhost:3301/en/admin/system/ui-components"});
    res.end(); return;
  }
  let payload = {};
  if (url.pathname === "/auth/me") {
    const denied = (req.headers.cookie || "").includes("einui_role=user");
    payload = {id:"local-ui-fixture",email:"ui-fixture@example.invalid",username:"Local QA",isSuperadmin:!denied,hasAdminBackendAccess:!denied,maintenance:{activeForUser:false}};
  } else if (url.pathname === "/settings/access-section") payload = {visibility:{}};
  else if (url.pathname === "/settings/subscription") payload = {features:{},plan:"free"};
  else if (url.pathname === "/dashboard/alerts") payload = {items:[],alerts:[],unreadCount:0};
  else if (url.pathname === "/dashboard/overview") payload = {accounts:[],items:[]};
  else if (url.pathname === "/api/billing/ai-credits/summary") payload = {balance:"0",available:"0",reserved:"0",warningLevel:"none"};
  else if (url.pathname === "/system/settings") payload = {maintenance:{enabled:false}};
  else if (url.pathname === "/system/maintenance") payload = {enabled:false};
  else { res.writeHead(404); res.end(JSON.stringify({error:"unconfigured_local_fixture"})); return; }
  res.end(JSON.stringify(payload));
});
server.listen(port,"127.0.0.1",()=>console.log(`Read-only Ein UI fixture on http://127.0.0.1:${port}`));
