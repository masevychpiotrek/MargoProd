import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const compiled=ts.transpileModule(fs.readFileSync(new URL('../src/pages/operator/ProductionOrders.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText
const domain=ts.transpileModule(fs.readFileSync(new URL('../src/lib/productionJobs.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2020,target:ts.ScriptTarget.ES2020}}).outputText
const lib=await import(`data:text/javascript;base64,${Buffer.from(domain).toString('base64')}`)
function mount(fail=false) {
 const components=['lewa','prawa'].map((side,i)=>({id:side,job_id:'job',component_key:`dren_st1_${side}`,component_label:side,is_dren:true,batch_number:null,sort_order:13+i}))
 const state=[];let cursor=0,tree,written
 const jsx=(type,props)=>({type,props})
 const exports={}
 const chain={update:value=>{written=value;return chain},eq:()=>chain,is:()=>chain,select:()=>chain,single:async()=>{if(fail)throw new Error('network down');return {data:{...components[0],...written},error:null}}}
 vm.runInNewContext(compiled,{exports,require:name=>{
  if(name==='react')return {useState:initial=>{const index=cursor++;if(!(index in state))state[index]=index===0?{id:'job',status:'active',calculated_qty:1}:index===1?components:index===3?false:initial;return [state[index],value=>state[index]=typeof value==='function'?value(state[index]):value]},useRef:()=>({current:{}}),useEffect:()=>{}}
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx}
  if(name==='@/stores/shiftStore')return {useShiftStore:()=>({activeMachine:{id:'machine',name:'A'},activeShift:{id:'shift',shift_type:'I'}})}
  if(name==='@/stores/authStore')return {useAuthStore:()=>({profile:{id:'actor',full_name:'Operator'}})}
  if(name==='@/lib/supabase')return {supabase:{from:()=>chain},logAudit:()=>new Promise(()=>{})}
  if(name==='@/lib/productionJobs')return lib
  if(name==='@/lib/utils')return {cn:(...args)=>args.join(' ')}
  return {}
 },requestAnimationFrame:()=>{},window:{matchMedia:()=>({matches:false})}})
 const render=()=>{cursor=0;tree=exports.default();return tree}
 const rows=()=>{const found=[];const visit=n=>{if(!n||typeof n!=='object')return;if(n.props?.component)found.push(n.props);const children=n.props?.children;for(const child of Array.isArray(children)?children.flat(Infinity):[children])visit(child)};visit(tree);return found}
 render();return {render,rows}
}

test('Manual and scanned values share save path; audit delay cannot block confirmation; spool IDs stay attached',async()=>{
 const app=mount()
 assert.deepEqual(app.rows().map(row=>row.component.id),['prawa','lewa'])
 app.rows()[1].onValueChange('0012345');app.render()
 await app.rows()[1].onSaveEntry();app.render()
 assert.equal(app.rows()[1].component.batch_number,'0012345')
 assert.equal(app.rows()[1].saving,false)
})

test('Failed save keeps entered batch and shows field error; save button is re-enabled',async()=>{
 const app=mount(true)
 app.rows()[1].onValueChange('LOT-987');app.render()
 await app.rows()[1].onSaveEntry();app.render()
 assert.equal(app.rows()[1].value,'LOT-987')
 assert.equal(app.rows()[1].component.batch_number,null)
 assert.ok(app.rows()[1].error.includes('network down'))
 assert.equal(app.rows()[1].saving,false)
})

test('Hosting rewrite sends nested app routes to index without replacing assets',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'))
 const route=new RegExp(`^${config.rewrites[0].source}$`)
 assert.ok(route.test('/operator/production-orders'))
 assert.ok(route.test('/manager/production-jobs'))
 assert.ok(!route.test('/assets/app.js'))
 assert.ok(!route.test('/chat-push-sw.js'))
 assert.equal(config.rewrites[0].destination,'/index.html')
})
