(function(root){
  'use strict';

  const CLIENT_ID='694415647324-ikfinucstrqjj6qc0b7fahoaout8plj6.apps.googleusercontent.com';
  const SCOPES='https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.events';
  const SESSION_KEY='crm_workspace_mcp_session';
  const AUTHORIZED_KEY='crm_workspace_mcp_authorized';
  const SESSION_VERSION=2;
  const ENDPOINTS={gmail:'https://gmailmcp.googleapis.com/mcp/v1',calendar:'https://calendarmcp.googleapis.com/mcp/v1'};
  let tokenClient=null;
  const approvals=new Map();

  function readSession(){try{const value=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'{}');return value.version===SESSION_VERSION&&value.accessToken&&Number(value.expiresAt)>Date.now()+60_000?value:{}}catch{return{}}}
  function readAuthorization(){try{const value=JSON.parse(localStorage.getItem(AUTHORIZED_KEY)||'{}');return value.version===1&&String(value.email||'').toLowerCase()===String(root.CRM_EMAIL_ACCOUNT||'erichepple7@gmail.com').toLowerCase()?value:null}catch{return null}}
  const saved=readSession();
  const priorAuthorization=readAuthorization();
  const state={accessToken:saved.accessToken||'',expiresAt:Number(saved.expiresAt)||0,email:saved.email||priorAuthorization?.email||'',connected:Boolean(saved.accessToken),authorized:Boolean(priorAuthorization)};
  const valid=()=>state.connected&&state.accessToken&&Date.now()<state.expiresAt-60_000;
  const save=()=>sessionStorage.setItem(SESSION_KEY,JSON.stringify({version:SESSION_VERSION,accessToken:state.accessToken,expiresAt:state.expiresAt,email:state.email}));

  async function profile(){const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:`Bearer ${state.accessToken}`}}),data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error?.message||'Google could not confirm the connected account.');return data}
  async function accept(response){if(response.error)throw Error(response.error_description||'Google did not connect Haven.');state.accessToken=response.access_token;state.expiresAt=Date.now()+(Number(response.expires_in)||3600)*1000;state.connected=true;const details=await profile();if(String(details.emailAddress||'').toLowerCase()!==String(root.CRM_EMAIL_ACCOUNT||'erichepple7@gmail.com').toLowerCase()){disconnect(true);throw Error(`Connect ${root.CRM_EMAIL_ACCOUNT||'erichepple7@gmail.com'}, not another Google account.`)}state.email=details.emailAddress;state.authorized=true;localStorage.setItem(AUTHORIZED_KEY,JSON.stringify({version:1,email:state.email}));save();render();root.toast?.('Haven is connected to Gmail and Calendar through Google MCP')}
  function client(){if(!root.google?.accounts?.oauth2)throw Error('Google sign-in is still loading. Try again in a moment.');if(!tokenClient)tokenClient=root.google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPES,callback:()=>{}});return tokenClient}
  function connect(){try{const oauth=client();oauth.callback=response=>accept(response).catch(error=>{disconnect(true);root.toast?.(error.message,true)});oauth.requestAccessToken({prompt:state.authorized?'':'consent',hint:root.CRM_EMAIL_ACCOUNT||'erichepple7@gmail.com'})}catch(error){root.toast?.(error.message,true)}}
  function disconnect(quiet=false){const token=state.accessToken;if(token&&root.google?.accounts?.oauth2)root.google.accounts.oauth2.revoke(token,()=>{});sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(AUTHORIZED_KEY);Object.assign(state,{accessToken:'',expiresAt:0,email:'',connected:false,authorized:false});render();if(!quiet)root.toast?.('Haven Google access disconnected')}

  const mutationPattern=/(?:^|[_./-])(create|update|edit|delete|remove|trash|archive|move|modify|send|reply|draft|insert|patch|cancel)(?:$|[_./-])/i;
  const toolName=(method,params)=>method==='tools/call'?String(params?.name||''):String(method||'');
  const isMutation=(method,params)=>mutationPattern.test(toolName(method,params));
  const fingerprint=(service,method,params)=>JSON.stringify({service,method,params});
  function approveOnce({service,method='tools/call',params={},summary=''}){if(!isMutation(method,params))return'';const description=String(summary||toolName(method,params)||'Google change').trim(),approved=confirm(`Approve this one Google action?\n\n${description}\n\nThis approval applies only to this action.`);if(!approved)throw Error('Google action was not approved.');const token=crypto.randomUUID();approvals.set(token,{fingerprint:fingerprint(service,method,params),expiresAt:Date.now()+5*60*1000});return token}
  function consumeApproval(token,service,method,params){const approval=approvals.get(token);approvals.delete(token);return Boolean(approval&&approval.expiresAt>Date.now()&&approval.fingerprint===fingerprint(service,method,params))}
  async function call(service,method,params={},options={}){if(!valid())throw Error('Connect Haven to Google in Inbox & Drafts first.');if(isMutation(method,params)&&!consumeApproval(options.approvalToken,service,method,params))throw Error('Review and approve this exact Google action before Haven can perform it.');const endpoint=ENDPOINTS[service];if(!endpoint)throw Error('Unknown Google MCP service.');const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${state.accessToken}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method,params})});const text=await response.text();if(!response.ok)throw Error(`Google ${service} MCP could not complete the request.`);const payload=text.trim().startsWith('{')?JSON.parse(text):text.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean).map(line=>JSON.parse(line)).at(-1);if(payload?.error)throw Error(payload.error.message||`Google ${service} MCP request failed.`);return payload?.result??payload}

  function card(){const status=valid()?`${state.email} · Gmail and Calendar use Google MCP`:state.authorized?`${state.email} is saved. Google access tokens expire; renew access here when needed. Haven still asks your approval before every change.`:'Separate AI-agent permission for Gmail and Calendar. Haven asks your approval before every change.';return `<div class="gmail-agent-access"><div><strong>Haven Google access</strong><small>${status}</small></div><div>${valid()?'<button type="button" class="btn" id="workspaceMcpDisconnect">Disconnect Haven</button>':`<button type="button" class="btn" id="workspaceMcpConnect">${state.authorized?'Renew Haven access':'Connect Haven to Google'}</button>`}</div></div>`}
  function bind(){const connectButton=document.querySelector('#workspaceMcpConnect'),disconnectButton=document.querySelector('#workspaceMcpDisconnect');if(connectButton)connectButton.onclick=connect;if(disconnectButton)disconnectButton.onclick=()=>disconnect()}
  function render(){const host=document.querySelector('#gmailConnection');if(!host)return;const old=host.querySelector('.gmail-agent-access');if(old)old.remove();host.insertAdjacentHTML('beforeend',card());bind()}
  const observer=new MutationObserver(()=>{if(document.querySelector('#gmailConnection')&&!document.querySelector('.gmail-agent-access'))render()});observer.observe(document.documentElement,{childList:true,subtree:true});
  root.crmWorkspaceMcp={state,valid,connect,disconnect,call,approveOnce,isMutation,render};
  window.addEventListener('load',()=>setTimeout(render,400));
})(typeof globalThis!=='undefined'?globalThis:this);
