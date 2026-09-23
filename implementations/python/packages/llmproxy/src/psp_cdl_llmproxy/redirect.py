# SPDX-License-Identifier: Apache-2.0
"""Host-selected, same-owner completion handoff; no automatic target inference."""
from psp_cdl_cdl import evaluate_batch
from psp_cdl_api_server.redirect_state import REDIRECT_PROFILE, valid_redirect, valid_redirect_target
from psp_cdl_mcpproxy import binding_digest
from .durable import DurableLlmLoop, call, actor
from .loop import LoopError, copy


class RedirectingLlmLoop(DurableLlmLoop):
    _completion_policy = "redirect"

    def __init__(self,store,gate,host,provider,configuration=None):
        super().__init__(store,gate,host,provider,{"postCompletion":"lockdown"})
        if not store.redirect_turns or any(not callable(getattr(host,k,None)) for k in ("resolve_redirect","redirect_policy")): raise LoopError("INVALID_CONFIGURATION")
        if type(configuration) is not dict or set(configuration)!={"postCompletion","target"} or configuration["postCompletion"]!="redirect" or not valid_redirect_target(configuration["target"]): raise LoopError("UNSUPPORTED_POST_COMPLETION")
        self._target=configuration["target"]

    def _prepare_commit(self,p,binding,command,options):
        self._check(options)
        redirect=None
        if command["complete"]:
            resolved=copy(call(lambda:self._host.resolve_redirect(copy(p),copy({**binding,"requestId":command["requestId"],"postCompletion":"redirect"}),self._target)),"INVALID_REDIRECT")
            if type(resolved) is not dict or set(resolved)!={"expiresAt","nodeId","nodeVersion","policyVersion"}: raise LoopError("INVALID_REDIRECT")
            redirect={**resolved,"target":self._target}
            source=self._store.execute(actor(p),{"action":"getSession","sessionId":command["sessionId"]})
            if not valid_redirect(redirect) or redirect["nodeId"]==command["nodeId"] or not self._host.now()<redirect["expiresAt"]<=source["expiresAt"]: raise LoopError("INVALID_REDIRECT")
        self._check(options)
        return {**command,"action":"commitRedirectTurn","redirect":redirect}

    def _authorize_commit(self,p,binding,context,options):
        super()._authorize_commit(p,binding,context,options)
        command=context["command"]
        if not command["complete"]: return
        bound={**binding,"requestId":command["requestId"],"postCompletion":"redirect","redirect":context["result"]["redirect"],"commandDigest":binding_digest(command)}
        data={"output":command["output"],"retained":command["retained"]}
        policy=copy(call(lambda:self._host.redirect_policy(copy(p),copy(bound),copy(data))),"INVALID_POLICY")
        if type(policy) is not dict or set(policy)!={"bindingDigest","resources"} or policy["bindingDigest"]!=binding_digest(bound) or type(policy["resources"]) is not list or not policy["resources"]: raise LoopError("INVALID_POLICY")
        decision=evaluate_batch(policy["resources"])["decision"]
        if decision=="unsupported": raise LoopError("UNSUPPORTED_POLICY")
        if decision!="allow": raise LoopError("REDIRECT_DENIED")
        self._check(options,context["result"]["redirect"]["expiresAt"])

    @staticmethod
    def _present(receipt,recovered):
        return {**DurableLlmLoop._present(receipt,recovered),**({"redirect":copy(receipt["redirect"])} if "redirect" in receipt else {})}
