// SPDX-License-Identifier: Apache-2.0
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import {parseJson} from '@psp-cdl/core';
import {TextProvider,requireThat} from './campaign-provider.mjs';
import {CampaignHost} from './campaign-host.mjs';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
let host,providers,live,cancelled,scripted;
try{
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
    try{
      requireThat(Buffer.byteLength(line)<=4*1024*1024,'REQUEST_TOO_LARGE');const r=parseJson(line);let value;
      if(r.op==='init'){
        requireThat(!host,'ALREADY_STARTED');const c=r.config,l=c.limits;live=r.live;
        requireThat(live===(process.argv.slice(2).join(',')==='--allow-live'),'LIVE_NOT_ADMITTED');
        const end=performance.now()+l.episodeTimeoutSeconds*1000;cancelled=()=>performance.now()>=end||existsSync(r.cancelFile);
        host=await CampaignHost.create(r.case,r.gated,r.secret,r.database,live?c.roles.defender.sources:[{id:'synthetic-offline',capabilities:[]}],emit,Math.floor(Date.now()/1000)+l.episodeTimeoutSeconds);
        const transport=body=>{
          const q=parseJson(body.toString('utf8')),model=q.model;
          const v=model.startsWith('claude-')?{model,type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:scripted}],usage:{input_tokens:30,output_tokens:20}}:
            {model,choices:[{finish_reason:'stop',message:{role:'assistant',content:scripted}}],usage:{prompt_tokens:30,completion_tokens:20}};
          return {status:200,contentType:'application/json',body:Buffer.from(JSON.stringify(v))};
        };
        providers=Object.fromEntries(Object.entries(c.roles).map(([role,p])=>[role,new TextProvider(p,l,l.maxTurns*(role==='defender'?l.maxDefenderCallsPerTurn:1),{live,allowLive:live,transport:live?null:transport,cancelled})]));
        value=await host.view();
      }else{
        requireThat(!!host,'NOT_STARTED');requireThat(!cancelled(),'CANCELLED');
        if(r.op==='invoke'){requireThat(!live||!('scripted' in r),'INVALID_REQUEST');scripted=r.scripted??'';value=await providers[r.role].invoke(r.system,r.messages);}
        else if(r.op==='turn'){host.turn=r.turn;host.payload=r.payload;value=await host.view();}
        else if(r.op==='view')value=await host.view();
        else if(r.op==='verify'){host.verifySystem(r.text);value=true;}
        else if(r.op==='execute')value=await host.execute(r.command,cancelled);
        else if(r.op==='release')value=host.release(r.text);
        else if(r.op==='close'){emit({kind:'result',value:true});break;}
        else throw new Error('INVALID_OPERATION');
      }
      emit({kind:'result',value});
    }catch(e){emit({kind:'error',code:e.code??'WORKER_ERROR'});}
  }
}finally{host?.close();}
