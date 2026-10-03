import {parseArgs} from 'node:util';
import {runtime} from './runtime.mjs';
import {scenario} from './scenario.mjs';
import {sandboxContracts} from './sandbox.mjs';
import {FACE_WORKFLOW_ID} from '../../packages/core/src/domain/event-model.ts';

const {values}=parseArgs({options:{provider:{type:'string',default:'fake'},runs:{type:'string',default:'1'}}});
if(!['fake','sandbox'].includes(values.provider))throw new Error('Use --provider fake or --provider sandbox');
const runs=Number(values.runs);
if(!Number.isInteger(runs)||runs<1||runs>10)throw new Error('--runs must be an integer from 1 to 10');
if(values.provider==='sandbox'&&runs!==1)throw new Error('Sandbox contracts run once; use --provider fake --runs 3 for the deterministic gate');
async function run(provider,work){
  const rt=await runtime(provider);
  const previousWorkflow=process.env.DIDIT_RENEWAL_WORKFLOW_ID;
  if(provider!=='sandbox')process.env.DIDIT_RENEWAL_WORKFLOW_ID=FACE_WORKFLOW_ID;
  try{await rt.step('database: isolated PostgreSQL and migrations',()=>rt.database());await work(rt);}
  catch(error){console.error(error.message);process.exitCode=1;}
  finally{
    try{await rt.finish();}catch(error){console.error(error.message);process.exitCode=1;}
    if(previousWorkflow===undefined)delete process.env.DIDIT_RENEWAL_WORKFLOW_ID;else process.env.DIDIT_RENEWAL_WORKFLOW_ID=previousWorkflow;
  }
}
if(values.provider==='sandbox')await run('sandbox',sandboxContracts);
for(let index=1;index<=runs&&!process.exitCode;index++){
  console.log(`Journey run ${index}/${runs}`);
  await run(values.provider==='sandbox'?'sandbox-injected':'fake',scenario);
}
