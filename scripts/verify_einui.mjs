import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";
import { createHash } from "node:crypto";
const root=process.cwd();
const base=path.join(root,"apps/web/components/einui");
const registry=JSON.parse(fs.readFileSync(path.join(base,"registry.upstream.json"),"utf8"));
const source=JSON.parse(fs.readFileSync(path.join(base,"source.json"),"utf8"));
const snapshot=JSON.parse(fs.readFileSync(path.join(base,"desk-files.json"),"utf8"));
for (const file of snapshot.files) assert.equal(createHash("sha256").update(fs.readFileSync(path.join(base,file.path))).digest("hex"),file.sha256,`Unreviewed Desk source change: ${file.path}`);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const examples=walk(path.join(base,"gallery")).filter(p=>p.endsWith(".tsx")).map(p=>fs.readFileSync(p,"utf8")).join("\n");
for(const item of registry.items){
 assert.ok(examples.includes(`"${item.name}"`),`Missing executable example: ${item.name}`);
 for(const file of item.files) assert.ok(fs.existsSync(path.join(base,file.path.replace(/^registry\//,""))),`Missing registry file: ${file.path}`);
}
for(const file of source.files) assert.ok(fs.existsSync(path.join(base,file.path)),`Missing website source: ${file.path}`);
assert.match(fs.readFileSync(path.join(base,"LICENSE"),"utf8"),/MIT License/);
const theme=fs.readFileSync(path.join(base,"theme.css"),"utf8");
assert.ok(!theme.includes('"tailwindcss/preflight.css"'));
assert.match(theme,/prefix\(ein\)/);
const graph=new Map();
function imports(file){
 if(graph.has(file))return graph.get(file);
 const content=fs.readFileSync(file,"utf8");
 const tree=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,file.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const found=[];
 function visit(node){
  let value;
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))value=node.moduleSpecifier.text;
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))value=node.arguments[0].text;
  if(value&&(value.startsWith(".")||value.startsWith("@/"))){
   const target=value.startsWith("@/")?path.join(root,"apps/web",value.slice(2)):path.resolve(path.dirname(file),value);
   const resolved=[target,target+".tsx",target+".ts",path.join(target,"index.tsx"),path.join(target,"index.ts")].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
   if(resolved&&/\.tsx?$/.test(resolved)&&resolved.startsWith(path.join(root,"apps/web")))found.push(resolved);
  }
  ts.forEachChild(node,visit);
 }
 visit(tree);graph.set(file,found);return found;
}
function closure(file,seen=new Set()) {if(seen.has(file))return seen;seen.add(file);for(const child of imports(file))closure(child,seen);return seen;}
const routes=walk(path.join(root,"apps/web/app")).filter(p=>p.endsWith("/page.tsx"));
const inventory=[];
for(const file of routes){
 const dependencies=[...closure(file)];
 const galleryRoute=file.includes("/admin/system/ui-components/");
 if(!galleryRoute) for(const dependency of dependencies) assert.ok(!dependency.includes("/einui/gallery/")&&!dependency.includes("/einui/blocks/"),`Gallery/template leaked into route: ${file} -> ${dependency}`);
 const adapters=dependencies.filter(p=>p.includes("/components/desk/")).map(p=>path.basename(p,".tsx")).sort();
 inventory.push({route:"/"+path.relative(path.join(root,"apps/web/app"),path.dirname(file)).replaceAll(path.sep,"/"),file:path.relative(root,file),adapters:[...new Set(adapters)],status:galleryRoute?"Internal gallery":adapters.length?"Migrated native adapters; specialized controllers retained":"Redirect/delegated or specialized page; shared Ocean shell retained"});
}
console.log(JSON.stringify({registryItems:registry.items.length,websiteSourceFiles:source.files.length,routeCount:routes.length,checks:"registry, source inventory, license, prefix, route import isolation",routes:inventory},null,2));
