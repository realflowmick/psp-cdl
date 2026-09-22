// SPDX-License-Identifier: Apache-2.0
import type { Readable, Writable } from "node:stream";
import { once } from "node:events";
import { canonicalJson } from "@psp-cdl/core";
import { MAX_REQUEST_BYTES } from "@psp-cdl/api-server";
import { McpServer } from "./server.js";
/** Bounded newline framing; stdout carries protocol messages only. Oversized/truncated frames close the connection. */
export async function serveStdio(server:McpServer,input:Readable=process.stdin,output:Writable=process.stdout):Promise<void> {
  let pending=Buffer.alloc(0);
  for await(const chunk of input) {
    const bytes=Buffer.from(chunk);
    let start=0;
    while(start<bytes.length) {
      const newline=bytes.indexOf(10,start), end=newline<0?bytes.length:newline;
      if(pending.length+end-start>MAX_REQUEST_BYTES) throw new Error("FRAME_TOO_LARGE");
      pending=Buffer.concat([pending,bytes.subarray(start,end)]);
      if(newline<0) break;
      const source=new TextDecoder("utf-8",{fatal:true}).decode(pending);
      pending=Buffer.alloc(0);start=newline+1;
      const reply=await server.handle(source);
      if(reply!==null&&!output.write(canonicalJson(reply)+"\n")) await once(output,"drain");
    }
  }
  if(pending.length) throw new Error("TRUNCATED_FRAME");
}
