import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('Batch exchange isolates jobs, rejects stale edits and rolls back failures without losing history', async () => {
 const db = new PGlite()
 const actor='00000000-0000-0000-0000-000000000001', job='00000000-0000-0000-0000-000000000002', other='00000000-0000-0000-0000-000000000003', component='00000000-0000-0000-0000-000000000004'
 try {
 await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${actor}'::uuid $$;
 CREATE TABLE profiles(id uuid,role text,is_active boolean,deleted_at timestamptz);
 CREATE TABLE production_jobs(id uuid PRIMARY KEY,status text);
 CREATE TABLE production_job_components(id uuid PRIMARY KEY,job_id uuid,batch_number text,entered_at timestamptz,entered_by uuid,status text);
 CREATE TABLE production_job_component_history(id uuid DEFAULT gen_random_uuid(),component_id uuid,job_id uuid,previous_batch_number text,new_batch_number text,changed_by uuid,changed_at timestamptz DEFAULT now());
 INSERT INTO profiles VALUES('${actor}','operator',true,null);
 INSERT INTO production_jobs VALUES('${job}','active'),('${other}','active');
 INSERT INTO production_job_components VALUES('${component}','${job}','OLD',null,null,'aktywny');`)
 await db.exec(await readFile(new URL('../supabase/migrations/082_production_job_batch_exchange.sql', import.meta.url),'utf8'))
 const exchange=(j,previous,next)=>db.query('SELECT * FROM production_job_exchange_batch($1,$2,$3,$4)',[component,j,previous,next])
 await assert.rejects(exchange(other,'OLD','NEW'),/nie należy/)
 await exchange(job,'OLD','NEW')
 await assert.rejects(exchange(job,'OLD','STALE'),/innego operatora/)
 assert.equal((await db.query('SELECT count(*) n FROM production_job_component_history')).rows[0].n,1)
 await db.exec(`CREATE FUNCTION fail_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
 CREATE TRIGGER fail BEFORE UPDATE ON production_job_components FOR EACH ROW EXECUTE FUNCTION fail_update();`)
 await assert.rejects(exchange(job,'NEW','FAIL'),/simulated failure/)
 assert.equal((await db.query('SELECT batch_number FROM production_job_components')).rows[0].batch_number,'NEW')
 assert.equal((await db.query('SELECT count(*) n FROM production_job_component_history')).rows[0].n,1)
 await db.exec('DROP TRIGGER fail ON production_job_components')
 await exchange(job,'NEW','NEXT')
 assert.deepEqual((await db.query('SELECT previous_batch_number,new_batch_number FROM production_job_component_history ORDER BY changed_at')).rows,[{previous_batch_number:'OLD',new_batch_number:'NEW'},{previous_batch_number:'NEW',new_batch_number:'NEXT'}])
 } finally {await db.close()}
})

test('Job summary keeps every batch used in the job, including its first batch', async () => {
 const ts = (await import('typescript')).default
 const source=await readFile(new URL('../src/lib/productionJobs.ts',import.meta.url),'utf8')
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2020,target:ts.ScriptTarget.ES2020}}).outputText
 const {collectComponentBatches,formatJobCopyText}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
 const component={id:'current-component',job_id:'current-job',component_key:'igla',component_label:'Igła',sort_order:1,is_dren:false,batch_number:'CURRENT'}
 const history=[{component_id:'current-component',previous_batch_number:'FIRST',new_batch_number:'CURRENT'}, {component_id:'other-component',previous_batch_number:'FOREIGN',new_batch_number:'FOREIGN2'}]
 assert.deepEqual(collectComponentBatches([component],history)[0].batches,['CURRENT','FIRST'])
 assert.deepEqual(collectComponentBatches([{...component,batch_number:null}],[])[0].batches,[])
 const numbered=[{component_id:component.id,previous_batch_number:'LOT-10',new_batch_number:'LOT-2'}, {component_id:component.id,previous_batch_number:' LOT-2 ',new_batch_number:'LOT-1'}]
 assert.deepEqual(collectComponentBatches([{...component,batch_number:'LOT-10'}],numbered)[0].batches,['LOT-1','LOT-2','LOT-10'])
 const copied=formatJobCopyText({job:{order_number:'Z/1',calculated_qty:1},machineName:'A',operatorName:'B',components:[component],history:history.slice(0,1)})
 assert.ok(copied.includes('Igła: CURRENT, FIRST'))
})
